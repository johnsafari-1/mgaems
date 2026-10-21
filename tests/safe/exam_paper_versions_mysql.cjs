// Restores a verified private SQL backup into a new, network-isolated MySQL 8.0
// container, runs ONLY the additive exam-paper version/header-template migration,
// and proves column + index creation with every row count unchanged.
// No active database writes, host ports, persistent mounts, or .env changes.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const backupPath = path.resolve(root, process.argv[2] || 'storage/app/private/curriculum-pilot/mgaems-before-curriculum-2026-10-17T21-30-24-311Z.sql');
const migrationFile = '2026_10_18_000044_add_exam_paper_versions_and_header_templates.php';
const privateRoot = path.join(root, 'storage/app/private') + path.sep;
if (!backupPath.startsWith(privateRoot) || !backupPath.endsWith('.sql')) throw new Error('Backup must be a private workspace SQL dump.');
const filename = path.relative(root, backupPath);
const evidence = JSON.parse(fs.readFileSync(backupPath + '.verification.json', 'utf8'));
const dump = fs.readFileSync(backupPath);
if (crypto.createHash('sha256').update(dump).digest('hex') !== evidence.sha256 || dump.length !== evidence.bytes) throw new Error('Existing backup verification failed.');
const run = crypto.randomBytes(8).toString('hex');
const name = 'mgaems-exam-version-drill-' + run;
const label = 'mgaems.exam-version-drill=' + run;
const password = crypto.randomBytes(32).toString('hex');
const database = 'mgaems_exam_version_test';
let container;
function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options }).trim();
}
function mysql(sql) {
  return docker(['exec', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot --batch --skip-column-names --database "$MYSQL_DATABASE" -e "$1"', 'isolated-read', sql]);
}
function php(command, extra = []) {
  return docker(['run', '--rm', '--pull', 'never', '--network', 'container:' + container,
    '--label', label, '--mount', 'type=bind,source=' + root + ',target=/var/www/html,readonly',
    '--mount', 'type=volume,source=mgaems_mgaems_vendor,target=/var/www/html/vendor,readonly',
    '--tmpfs', '/var/www/html/storage:rw,nosuid,size=128m', '--tmpfs', '/tmp:rw,nosuid,size=128m',
    '-e', 'APP_ENV=testing', '-e', 'DB_CONNECTION=mysql', '-e', 'DB_HOST=127.0.0.1', '-e', 'DB_PORT=3306',
    '-e', 'DB_DATABASE=' + database, '-e', 'DB_USERNAME=root', '-e', 'DB_PASSWORD=' + password,
    '-e', 'SESSION_DRIVER=array', '--entrypoint', 'php', 'mgaems-app:latest', command, ...extra], { timeout: 180000 });
}
try {
  console.log('PASS existing backup byte size and SHA256 validated');
  container = docker(['run', '-d', '--pull', 'never', '--name', name, '--label', label, '--network', 'none',
    '--tmpfs', '/var/lib/mysql:rw,nosuid,size=768m', '-e', 'MYSQL_ROOT_PASSWORD=' + password, '-e', 'MYSQL_DATABASE=' + database,
    'mysql:8.0', '--skip-log-bin']);
  const inspected = JSON.parse(docker(['inspect', container]))[0];
  if (inspected.Name !== '/' + name || inspected.HostConfig.NetworkMode !== 'none' || inspected.Mounts.some(m => m.Type !== 'tmpfs') || Object.keys(inspected.HostConfig.PortBindings || {}).length) throw new Error('Restore target isolation is invalid.');
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    const probe = spawnSync('docker', ['exec', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin --protocol=TCP -h127.0.0.1 -uroot ping --silent'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.includes('alive')) { ready = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  if (!ready) throw new Error('Isolated MySQL did not become ready.');
  mysql('SELECT 1');
  docker(['exec', '-i', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot --binary-mode=1 "$MYSQL_DATABASE"'], { input: dump });
  const tables = mysql('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE="BASE TABLE" ORDER BY TABLE_NAME').split('\n');
  if (tables.length !== evidence.tables || JSON.stringify(tables) !== JSON.stringify(Object.keys(evidence.rows).sort())) throw new Error('Restored table inventory differs.');
  const beforeCounts = mysql(tables.map(t => "SELECT '" + t + "',COUNT(*) FROM `" + t + '`').join(' UNION ALL '));
  for (const line of beforeCounts.split('\n')) { const [table, count] = line.split('\t'); if (Number(count) !== evidence.rows[table]) throw new Error('Restored row count differs: ' + table); }
  const sampleBefore = mysql("SELECT id,COALESCE(title,'') FROM exam_papers ORDER BY id LIMIT 1");
  if (evidence.rows.exam_papers > 0 && !sampleBefore) throw new Error('Expected an exam_papers sample row.');
  console.log('PASS isolated MySQL 8.0 restore: all ' + tables.length + ' table inventories and row counts match backup evidence');

  const migrationOutput = php('artisan', ['migrate', '--path=database/migrations/' + migrationFile, '--force', '--no-interaction']);
  console.log('PASS migration applied on isolated schema: ' + (migrationOutput.split('\n').filter(Boolean).pop() || 'ok'));

  const columns = mysql("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='exam_papers' AND COLUMN_NAME IN ('header_template','version_number','source_exam_paper_id','source_revision_number') ORDER BY COLUMN_NAME").split('\n').filter(Boolean);
  if (JSON.stringify(columns) !== JSON.stringify(['header_template', 'source_exam_paper_id', 'source_revision_number', 'version_number'])) throw new Error('New columns were not created: ' + JSON.stringify(columns));
  const index = mysql("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='exam_papers' AND INDEX_NAME='uq_exam_paper_source_version' LIMIT 1");
  if (index !== 'uq_exam_paper_source_version') throw new Error('Unique source/version index was not created.');
  console.log('PASS columns and unique source/version index created on exam_papers');

  const afterCounts = mysql(tables.map(t => "SELECT '" + t + "',COUNT(*) FROM `" + t + '`').join(' UNION ALL '));
  const beforeMap = Object.fromEntries(beforeCounts.split('\n').map(line => line.split('\t')));
  const afterMap = Object.fromEntries(afterCounts.split('\n').map(line => line.split('\t')));
  for (const table of tables) {
    if (table === 'migrations') continue;
    if (afterMap[table] !== beforeMap[table]) throw new Error('Row count changed across the migration: ' + table);
  }
  if (Number(afterMap.migrations) !== Number(beforeMap.migrations) + 1) throw new Error('The migration ledger should gain exactly one row.');
  const sampleAfter = mysql("SELECT id,COALESCE(title,'') FROM exam_papers ORDER BY id LIMIT 1");
  if (sampleAfter !== sampleBefore) throw new Error('exam_papers sample data changed across the migration.');
  const defaults = mysql("SELECT CONCAT(header_template,'|',version_number,'|',IFNULL(source_exam_paper_id,'NULL')) FROM exam_papers ORDER BY id LIMIT 1");
  if (evidence.rows.exam_papers > 0 && defaults !== 'classic|1|NULL') throw new Error('Migration defaults are unexpected: ' + defaults);
  console.log('PASS every row count and sampled exam_papers value unchanged after migration');

  const report = { backup: filename, backup_sha256: evidence.sha256, migrated_file: migrationFile, restored_tables: tables.length,
    restored_row_counts_match: true, columns_created: columns, unique_index: index, isolated_container: name, isolated_database: database,
    active_database_modified: false, completed_at: new Date().toISOString() };
  const reportDir = path.join(root, 'storage/app/private/exam-paper-versions');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'migration-drill-' + run + '.json'), JSON.stringify(report, null, 2));
  console.log('PASS migration drill evidence written to storage/app/private/exam-paper-versions');
} finally {
  if (container) {
    const owned = JSON.parse(docker(['inspect', container]))[0];
    if (owned.Name !== '/' + name || owned.Config.Labels['mgaems.exam-version-drill'] !== run || owned.HostConfig.NetworkMode !== 'none') throw new Error('Refusing cleanup: container ownership differs.');
    docker(['rm', '-f', container]);
    console.log('PASS owned disposable container removed; active containers and volumes untouched');
  }
}
