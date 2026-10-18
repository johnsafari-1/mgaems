// Restores only into a newly created, network-isolated MySQL container.
// No active database writes, host ports, persistent mounts, or .env changes.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const backupPath = path.resolve(root, process.argv[2] || 'storage/app/private/ollama-preflight/mgaems-before-ollama-2026-10-17T20-47-48-001Z.sql');
const privateRoot = path.join(root, 'storage/app/private') + path.sep;
if (!backupPath.startsWith(privateRoot) || !backupPath.endsWith('.sql')) throw new Error('Backup must be a private workspace SQL dump.');
const filename = path.relative(root, backupPath);
const evidence = JSON.parse(fs.readFileSync(backupPath + '.verification.json', 'utf8'));
const dump = fs.readFileSync(backupPath);
if (crypto.createHash('sha256').update(dump).digest('hex') !== evidence.sha256 || dump.length !== evidence.bytes) throw new Error('Existing backup verification failed.');
const run = crypto.randomBytes(8).toString('hex');
const name = 'mgaems-curriculum-drill-' + run;
const label = 'mgaems.curriculum-drill=' + run;
const password = crypto.randomBytes(32).toString('hex');
const database = 'mgaems_curriculum_test';
let container;
function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options }).trim();
}
function mysql(sql) {
  return docker(['exec', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot --batch --skip-column-names --database "$MYSQL_DATABASE" -e "$1"', 'isolated-read', sql]);
}
function php(script, extra = []) {
  return docker(['run', '--rm', '--pull', 'never', '--network', 'container:' + container,
    '--label', label, '--mount', 'type=bind,source=' + root + ',target=/var/www/html,readonly',
    '--mount', 'type=volume,source=mgaems_mgaems_vendor,target=/var/www/html/vendor,readonly',
    '--tmpfs', '/var/www/html/storage:rw,nosuid,size=128m', '--tmpfs', '/tmp:rw,nosuid,size=128m',
    '-e', 'APP_ENV=testing', '-e', 'DB_CONNECTION=mysql', '-e', 'DB_HOST=127.0.0.1', '-e', 'DB_PORT=3306',
    '-e', 'DB_DATABASE=' + database, '-e', 'DB_USERNAME=root', '-e', 'DB_PASSWORD=' + password,
    '-e', 'MGAEMS_CURRICULUM_TEST_UUID=' + mysql('SELECT @@server_uuid'), '-e', 'SESSION_DRIVER=array',
    '--entrypoint', 'php', 'mgaems-app:latest', '-d', 'zend.exception_ignore_args=1', script, ...extra], { timeout: 180000 });
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
  // mysqladmin can see a temporary initialization server; TCP/db checks guard it.
  mysql('SELECT 1');
  docker(['exec', '-i', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot --binary-mode=1 "$MYSQL_DATABASE"'], { input: dump });
  const tables = mysql('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE="BASE TABLE" ORDER BY TABLE_NAME').split('\n');
  if (tables.length !== evidence.tables || JSON.stringify(tables) !== JSON.stringify(Object.keys(evidence.rows).sort())) throw new Error('Restored table inventory differs.');
  const counts = mysql(tables.map(t => "SELECT '" + t + "',COUNT(*) FROM `" + t + '`').join(' UNION ALL '));
  for (const line of counts.split('\n')) { const [table, count] = line.split('\t'); if (Number(count) !== evidence.rows[table]) throw new Error('Restored row count differs: ' + table); }
  console.log('PASS isolated MySQL 8.0 restore: all ' + tables.length + ' table inventories and row counts match backup evidence');
  console.log(php('tests/safe/curriculum_library.php', ['--mysql']));
  const report = { backup: filename, backup_sha256: evidence.sha256, restored_tables: tables.length,
    restored_row_counts_match: true, isolated_container: name, schema_and_test_database: database,
    active_database_modified: false, completed_at: new Date().toISOString() };
  const reportDir = path.join(root, 'storage/app/private/curriculum-pilot');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'restore-test-evidence.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(reportDir, 'restore-test-evidence-' + run + '.json'), JSON.stringify(report, null, 2));
} finally {
  if (container) {
    const owned = JSON.parse(docker(['inspect', container]))[0];
    if (owned.Name !== '/' + name || owned.Config.Labels['mgaems.curriculum-drill'] !== run || owned.HostConfig.NetworkMode !== 'none') throw new Error('Refusing cleanup: container ownership differs.');
    docker(['rm', '-f', container]);
    console.log('PASS owned disposable container removed; active containers and volumes untouched');
  }
}
