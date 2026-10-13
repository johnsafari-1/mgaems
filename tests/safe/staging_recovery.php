<?php
// Synthetic full-application recovery only; launched by the owned fixture runner.
declare(strict_types=1);
function ensureRecovery(bool $ok,string $label):void {if(!$ok){fwrite(STDERR,'FAIL '.$label.PHP_EOL);exit(1);} }
function passRecovery(string $label):void {echo 'PASS '.$label.PHP_EOL;}
$mode=$argv[1]??'';
ensureRecovery(in_array($mode,['prepare','wrong-key','verify'],true),'explicit recovery mode');
ensureRecovery(getenv('MGAEMS_DISPOSABLE_STAGING')==='fresh-mysql-fixture' && preg_match('/^mgaems_stage_test_[a-f0-9]{8}$/D',getenv('DB_DATABASE')?:'') && getenv('DB_HOST')==='127.0.0.1' && getenv('DB_PORT')==='3306','owned recovery connection');
ensureRecovery(!is_file('/var/www/html/.env'),'no development dotenv');
require '/var/www/html/vendor/autoload.php';$app=require '/var/www/html/bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(static function(Throwable $e):void{fwrite(STDERR,'Recovery fixture failed: '.get_class($e).PHP_EOL);exit(1);});
$db=Illuminate\Support\Facades\DB::connection();$identity=$db->selectOne('SELECT DATABASE() AS db, @@server_uuid AS uuid');
ensureRecovery($identity->db===getenv('DB_DATABASE') && preg_match('/^[a-f0-9-]{36}$/D',getenv('MGAEMS_TEST_MYSQL_UUID')?:'') && $identity->uuid===getenv('MGAEMS_TEST_MYSQL_UUID'),'exact owned MySQL identity');
ensureRecovery(config('staging.enabled')&&config('app.env')==='production'&&config('session.serialization')==='json'&&config('session.encrypt')&&config('session.secure'),'staging recovery configuration');
$disk=Illuminate\Support\Facades\Storage::disk('private');
function recoveryHttp(string $method,string $path,?array $body=null,?string $token=null):array{
 $headers=['Accept: application/json','Origin: https://demo.invalid','X-Forwarded-Proto: https'];if($body!==null)$headers[]='Content-Type: application/json';if($token)$headers[]='Authorization: Bearer '.$token;
 $handle=curl_init('http://127.0.0.1:'.getenv('PORT').$path);curl_setopt_array($handle,[CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$headers,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>15]);if($body!==null)curl_setopt($handle,CURLOPT_POSTFIELDS,json_encode($body,JSON_THROW_ON_ERROR));
 $out=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_RESPONSE_CODE);curl_close($handle);return[$status,$out];
}
if($mode==='prepare'){
 $user=App\Models\User::where('username','demo-admin')->firstOrFail();
 [$status,$body]=recoveryHttp('POST','/api/v1/auth/login',['username'=>'demo-admin','password'=>getenv('MGAEMS_TEST_ADMIN_PASSWORD')]);ensureRecovery($status===200,'synthetic recovery login');$token=json_decode($body,true,512,JSON_THROW_ON_ERROR)['data']['token'];
 $store=app('session')->driver();$store->start();Illuminate\Support\Facades\Auth::guard('web')->login($user);$store->put('recovery_epoch',(int)$user->session_version);$store->save();
 $revision=App\Models\ReportCardRevision::orderByDesc('id')->firstOrFail();$pdf=$disk->get($revision->artifact_path);ensureRecovery(hash('sha256',$pdf)===$revision->artifact_sha256,'source artifact integrity');
 ensureRecovery($disk->put('recovery/uploaded-learner.txt','SYNTHETIC PRIVATE UPLOAD'), 'synthetic uploaded document');
 $manifest=['user_id'=>$user->id,'epoch'=>(int)$user->session_version,'session_id'=>$store->getId(),'password_hash'=>$user->password_hash,'token_ciphertext'=>Illuminate\Support\Facades\Crypt::encryptString($token),'artifact_path'=>$revision->artifact_path,'artifact_sha256'=>$revision->artifact_sha256,'report_id'=>$revision->report_card_id,'retained_artifacts'=>App\Models\ReportCardRevision::orderBy('id')->get(['artifact_path','artifact_sha256'])->toArray()];
 ensureRecovery($disk->put('recovery/manifest.json',json_encode($manifest,JSON_THROW_ON_ERROR)),'synthetic recovery manifest');
 passRecovery('synthetic private upload retained artifact encrypted session and token prepared; key excluded from manifest');exit;
}
$manifest=json_decode($disk->get('recovery/manifest.json'),true,512,JSON_THROW_ON_ERROR);
if($mode==='wrong-key'){
 $refused=false;try{Illuminate\Support\Facades\Crypt::decryptString($manifest['token_ciphertext']);}catch(Illuminate\Contracts\Encryption\DecryptException $e){$refused=true;}
 ensureRecovery($refused,'wrong recovery key must fail decryption');
 $store=app('session')->driver();$store->setId($manifest['session_id']);$store->start();ensureRecovery($store->get('recovery_epoch')===null,'wrong key must not restore session identity');
 passRecovery('wrong key cannot decrypt recovered token or session identity');exit;
}
ensureRecovery($db->table('migrations')->count()===39 && count($db->select('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE()'))===43,'recovered complete schema');passRecovery('complete synthetic database and migration ledger recovered');
ensureRecovery($disk->get('recovery/uploaded-learner.txt')==='SYNTHETIC PRIVATE UPLOAD','recovered upload');passRecovery('private uploaded document recovered without development storage');
foreach($manifest['retained_artifacts'] as $artifact)ensureRecovery(hash('sha256',$disk->get($artifact['artifact_path']))===$artifact['artifact_sha256'],'immutable recovered artifact');passRecovery('generated report artifacts recovered with exact SHA256 including earlier revisions');
$user=App\Models\User::findOrFail($manifest['user_id']);ensureRecovery($user->password_hash===$manifest['password_hash'] && (int)$user->session_version===$manifest['epoch'] && Illuminate\Support\Facades\Hash::check(getenv('MGAEMS_TEST_ADMIN_PASSWORD'),$user->password_hash),'credential and epoch recovery');
$token=Illuminate\Support\Facades\Crypt::decryptString($manifest['token_ciphertext']);
$store=app('session')->driver();$store->setId($manifest['session_id']);$store->start();Illuminate\Support\Facades\Auth::forgetGuards();ensureRecovery($store->get('recovery_epoch')===$manifest['epoch'] && Illuminate\Support\Facades\Auth::guard('web')->id()===$user->id,'encrypted session authentication recovery');passRecovery('separately supplied original key restores encrypted session and authentication epoch');
[$status]=recoveryHttp('GET','/api/v1/me',null,$token);ensureRecovery($status===200,'recovered bearer authentication');
[$status,$download]=recoveryHttp('GET','/api/v1/report-cards/'.$manifest['report_id'].'/download',null,$token);ensureRecovery($status===200 && hash('sha256',$download)===$manifest['artifact_sha256'],'recovered retained artifact download');passRecovery('original synthetic bearer and retained PDF download work after independent recovery');
[$status]=recoveryHttp('GET','/api/v1/health/profiles',null,$token);ensureRecovery($status===403,'System Administrator Health exclusion after recovery');
[$status]=recoveryHttp('GET','/storage/recovery/uploaded-learner.txt');ensureRecovery($status!==200,'recovered private upload must remain private');
ensureRecovery(config('mail.default')==='array' && array_keys(config('mail.mailers'))===['array'],'recovered mail sink');passRecovery('Health exclusion private upload boundary and mail isolation survive recovery');
ensureRecovery($disk->put('recovery/runtime-write.txt','SYNTHETIC PERMISSION CHECK')&&$disk->get('recovery/runtime-write.txt')==='SYNTHETIC PERMISSION CHECK','www-data storage write permissions');passRecovery('restored storage ownership and runtime write permissions work');
