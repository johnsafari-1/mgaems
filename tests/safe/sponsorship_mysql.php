<?php

// Run only through health_mysql.ps1: an unnetworked disposable MySQL instance,
// read-only source/vendor mounts, no dotenv and no ordinary migration execution.
ini_set('zend.exception_ignore_args', '1');
require dirname(__DIR__, 2).'/vendor/autoload.php';
$root = dirname(__DIR__, 2);
$app = require $root.'/bootstrap/app.php';
if ($app->configurationIsCached() || is_file($app->getCachedRoutesPath())
    || getenv('MGAEMS_DISPOSABLE_MYSQL') !== 'health-corrective-fixtures'
    || ! getenv('MGAEMS_TEST_MYSQL_PASSWORD')) {
    throw new RuntimeException('Refusing non-isolated MySQL test execution.');
}
$app->bootstrapWith([Illuminate\Foundation\Bootstrap\LoadConfiguration::class]);
$app['config']->set([
    'database.default' => 'health_disposable',
    'database.connections' => ['health_disposable' => [
        'driver' => 'mysql', 'host' => '127.0.0.1', 'port' => 3306,
        'database' => 'mgaems_health_corrective_tests', 'username' => 'root',
        'password' => getenv('MGAEMS_TEST_MYSQL_PASSWORD'), 'charset' => 'utf8mb4',
        'collation' => 'utf8mb4_unicode_ci', 'prefix' => '', 'strict' => true,
    ]],
    'app.env' => 'testing', 'app.debug' => false, 'app.timezone' => 'Africa/Nairobi',
    'app.key' => 'base64:'.base64_encode(str_repeat('t', 32)),
    'session.driver' => 'array', 'cache.default' => 'array',
    'cache.stores.array' => ['driver' => 'array', 'serialize' => false],
    'logging.default' => 'null',
    'logging.channels.null' => ['driver' => 'monolog', 'handler' => Monolog\Handler\NullHandler::class],
]);
$app->detectEnvironment(fn () => 'testing');
date_default_timezone_set('Africa/Nairobi');
$app->instance('request', Illuminate\Http\Request::create('/'));
$app->bootstrapWith([
    Illuminate\Foundation\Bootstrap\RegisterFacades::class,
    Illuminate\Foundation\Bootstrap\RegisterProviders::class,
    Illuminate\Foundation\Bootstrap\BootProviders::class,
]);

use App\Models\Sponsor;
use App\Models\Sponsorship;
use App\Models\Student;
use App\Services\AuditLogger;
use App\Services\SponsorshipOperations;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

function spMysqlEnsure(bool $valid, string $reason): void { if (! $valid) throw new RuntimeException($reason); }
$db=DB::connection();
spMysqlEnsure($db->getDriverName()==='mysql' && $db->getDatabaseName()==='mgaems_health_corrective_tests'
    && $db->getConfig('host')==='127.0.0.1' && array_keys(config('database.connections'))===['health_disposable'], 'Refusing unexpected database');
DB::listen(fn ($query) => spMysqlEnsure($query->connection->getDatabaseName()==='mgaems_health_corrective_tests', 'Unexpected query connection'));
$operations=app(SponsorshipOperations::class); $audit=app(AuditLogger::class);
$base=['sponsor_id'=>1,'sponsorship_type'=>'individual','start_date'=>'2026-10-01'];
if (($argv[1]??null)==='worker') {
    spMysqlEnsure(in_array($argv[2]??null,['create','resume'],true), 'Unknown fixture worker');
    $id=(int)$argv[3];
    $result=$argv[2]==='create' ? $operations->create($base+['student_id'=>$id],1,$audit)
        : $operations->update(Sponsorship::findOrFail($id),['status'=>'active'],$audit);
    echo json_encode(['code'=>$result['error']['code']??'OK']); exit;
}
spMysqlEnsure(DB::select('SHOW TABLES')===[], 'Refusing a nonempty disposable database');
Schema::create('users',fn(Blueprint $t)=>$t->id());
Schema::create('students',function(Blueprint $t){$t->id();$t->string('status');});
Schema::create('audit_logs',function(Blueprint $t){$t->id();$t->foreignId('user_id')->nullable();$t->string('action');$t->string('entity_type')->nullable();$t->unsignedBigInteger('entity_id')->nullable();$t->json('details')->nullable();$t->string('ip_address')->nullable();$t->timestamp('created_at');});
foreach (['2026_08_02_000018_create_sponsors_table.php','2026_08_02_000019_create_sponsorships_table.php','2026_09_28_000001_create_sponsorship_student_table.php'] as $fixture) (require $root.'/database/migrations/'.$fixture)->up();
DB::table('users')->insert(['id'=>1]);
DB::table('students')->insert([['id'=>1,'status'=>'active'],['id'=>2,'status'=>'active']]);
Sponsor::create(['name'=>'Disposable fixture','sponsor_type'=>'individual']);
function blockedWorker(string $kind,int $id): array {
    $process=proc_open([PHP_BINARY,__FILE__,'worker',$kind,(string)$id],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
    spMysqlEnsure(is_resource($process),'Fixture worker unavailable');fclose($pipes[0]);
    try {
        $waits=0;
        for($attempt=0;$attempt<50;$attempt++) {
            $waits=(int)DB::selectOne('SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits')->n;
            if($waits>0)break;
            spMysqlEnsure(proc_get_status($process)['running'],'Worker did not wait for learner lock');
            usleep(100000);
        }
        spMysqlEnsure($waits>0,'MySQL learner lock did not block competing operation');
        return [$process,$pipes];
    } catch(Throwable $failure) {proc_terminate($process);foreach($pipes as $pipe)if(is_resource($pipe))fclose($pipe);proc_close($process);throw $failure;}
}
function workerResult(array $worker): void {
    [$process,$pipes]=$worker;
    // The parent has committed; this competing operation must finish without a write.
    $until=microtime(true)+10;
    while(proc_get_status($process)['running'] && microtime(true)<$until)usleep(100000);
    if(proc_get_status($process)['running']){proc_terminate($process);throw new RuntimeException('Fixture worker timed out');}
    $output=stream_get_contents($pipes[1]);$error=stream_get_contents($pipes[2]);
    fclose($pipes[1]);fclose($pipes[2]);proc_close($process);
    spMysqlEnsure($error==='' && json_decode($output,true)===['code'=>'ALREADY_SPONSORED'],'Competing operation failed to enforce one-active assignment');
}
DB::beginTransaction();
try {
    Student::whereKey(1)->lockForUpdate()->firstOrFail();
    $worker=blockedWorker('create',1);
    $result=$operations->create($base+['student_id'=>1],1,$audit);spMysqlEnsure(isset($result['item']),'First create failed');
    DB::commit();workerResult($worker);
} catch(Throwable $failure){if(DB::transactionLevel())DB::rollBack();throw $failure;}
spMysqlEnsure(Sponsorship::where('student_id',1)->where('status','active')->count()===1,'Duplicate active individual after concurrent creates');
echo 'PASS disposable MySQL serializes concurrent individual creates on the learner lock'.PHP_EOL;
$paused=$operations->create($base+['student_id'=>2],1,$audit)['item'];$operations->update($paused,['status'=>'paused'],$audit);
DB::beginTransaction();
try {
    Student::whereKey(2)->lockForUpdate()->firstOrFail();
    $worker=blockedWorker('resume',$paused->id);
    spMysqlEnsure(isset($operations->create($base+['student_id'=>2],1,$audit)['item']),'Competing create failed');
    DB::commit();workerResult($worker);
} catch(Throwable $failure){if(DB::transactionLevel())DB::rollBack();throw $failure;}
spMysqlEnsure($paused->fresh()->status==='paused' && Sponsorship::where('student_id',2)->where('status','active')->count()===1,'Concurrent resume bypass');
echo 'PASS disposable MySQL blocks resume behind a competing create and rechecks committed assignments'.PHP_EOL;
$badAudit=new class(Illuminate\Http\Request::create('/')) extends AuditLogger {
    public function log(string $action,?string $entityType=null,?int $entityId=null,array $details=[]): App\Models\AuditLog {throw new RuntimeException('Deliberate fixture audit failure');}
};
$count=Sponsorship::count();$pivots=DB::table('sponsorship_student')->count();
try {$operations->create(['sponsor_id'=>1,'sponsorship_type'=>'group','start_date'=>'2026-10-01','student_ids'=>[1,2]],1,$badAudit);throw new LogicException('Audit fixture must fail');}
catch(RuntimeException $failure){spMysqlEnsure($failure->getMessage()==='Deliberate fixture audit failure','Unexpected rollback failure');}
spMysqlEnsure(Sponsorship::count()===$count && DB::table('sponsorship_student')->count()===$pivots,'MySQL partial group/audit write');
echo 'PASS disposable MySQL rolls back group creation and pivots when audit persistence fails'.PHP_EOL;
$pattern=App\Services\SponsorshipView::pattern('%_!');
$literal=DB::selectOne("SELECT ? LIKE ? ESCAPE '!' AS matches_literal, ? LIKE ? ESCAPE '!' AS matches_roster", ['Memory %_! learner',$pattern,'Memory learner',$pattern]);
spMysqlEnsure((int)$literal->matches_literal===1 && (int)$literal->matches_roster===0,'Literal MySQL search escaping failed');
echo 'PASS disposable MySQL treats search wildcards and escape characters as literal text'.PHP_EOL;
echo '4 Sponsorship MySQL checks passed on disposable tmpfs fixtures.'.PHP_EOL;
