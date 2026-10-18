param([string]$Image='mgaems-staging:security2b')
$ErrorActionPreference='Stop'
$sourceRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if($sourceRoot-ne'D:\mgaems'){throw 'Unexpected source workspace'}
$runId=[Guid]::NewGuid().ToString('N').Substring(0,8)
$testName="mgaems-stage-mysql-$runId"
$webName="mgaems-stage-web-$runId"
$fileVolume="mgaems-stage-files-$runId"
$evidencePath=Join-Path $sourceRoot "storage/app/private/staging-check-$runId"
New-Item -ItemType Directory -Path $evidencePath | Out-Null
$utf8=New-Object Text.UTF8Encoding($false)
function Quote-Native([string]$argument){'"'+[regex]::Replace([regex]::Replace($argument,'(\\*)"','$1$1\"'),'(\\+)$','$1$1')+'"'}
function Run-Docker([string[]]$arguments,[bool]$allowFailure=$false){
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName='docker.exe';$info.Arguments=($arguments|ForEach-Object {Quote-Native $_})-join ' '
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process;$process.StartInfo=$info
    if(-not$process.Start()){throw 'Docker process failed to start'}
    $outputTask=$process.StandardOutput.ReadToEndAsync();$errorTask=$process.StandardError.ReadToEndAsync()
    $process.WaitForExit();$output=$outputTask.GetAwaiter().GetResult();$diagnostics=$errorTask.GetAwaiter().GetResult()
    $result=[pscustomobject]@{ExitCode=$process.ExitCode;Output=$output;Diagnostics=$diagnostics}
    $process.Dispose()
    if($result.ExitCode-ne0-and-not$allowFailure){throw 'Fixture Docker operation failed; diagnostics are kept local'}
    return $result
}
function New-FixtureSecret(){
    $bytes=New-Object byte[] 32;$generator=[Security.Cryptography.RandomNumberGenerator]::Create()
    try{$generator.GetBytes($bytes);return -join($bytes|ForEach-Object {$_.ToString('x2')})}finally{$generator.Dispose()}
}
function Remove-OwnedContainer([string]$id,[string]$name){
    if(-not$id){return}
    $probe=Run-Docker @('inspect',$id) $true;if($probe.ExitCode-ne0){return}
    $actual=($probe.Output|ConvertFrom-Json)[0]
    if($actual.Id-ne$id-or$actual.Name-ne"/$name"-or$actual.Config.Labels.'mgaems.staging-test'-ne$runId){throw 'Fixture cleanup ownership differs'}
    Run-Docker @('rm','-f',$id)|Out-Null
}
$testId=$null;$webId=$null;$volumeCreated=$false
$databasePassword=New-FixtureSecret;$adminPassword=New-FixtureSecret
$appKey='base64:'+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runId.PadRight(32,'s')))
$databaseName="mgaems_stage_test_$runId"
$testMount="type=bind,source=$sourceRoot\tests\safe\staging_install.php,target=/tests/staging_install.php,readonly"
try {
    $mysqlImage=((Run-Docker @('image','inspect','mysql:8.4')).Output|ConvertFrom-Json)[0].Id
    $stagingImage=((Run-Docker @('image','inspect',$Image)).Output|ConvertFrom-Json)[0].Id
    $testId=(Run-Docker @('run','--pull','never','-d','--name',$testName,'--label',"mgaems.staging-test=$runId",'--network','none',
        '--tmpfs','/var/lib/mysql:rw,noexec,nosuid,size=512m','-e',"MYSQL_ROOT_PASSWORD=$databasePassword",'-e',"MYSQL_DATABASE=$databaseName",$mysqlImage)).Output.Trim()
    $actual=((Run-Docker @('inspect',$testId)).Output|ConvertFrom-Json)[0]
    if($actual.HostConfig.NetworkMode-ne'none'-or$actual.HostConfig.Tmpfs.'/var/lib/mysql'-notlike'*size=512m*'-or$actual.Mounts.Count){throw 'Fixture must have RAM data, no volumes and no network'}
    $ready=$false
    for($attempt=0;$attempt-lt60;$attempt++){
        $probe=Run-Docker @('exec','-e',"MYSQL_PWD=$databasePassword",$testId,'mysql','--protocol=TCP','-h','127.0.0.1','-uroot','-N','-e','SELECT 1') $true
        if($probe.ExitCode-eq0){$ready=$true;break};Start-Sleep -Seconds 1
    }
    if(-not$ready){throw 'Disposable MySQL did not become ready'}
    $fixtureUuid=(Run-Docker @('exec','-e',"MYSQL_PWD=$databasePassword",$testId,'mysql','--protocol=TCP','-h','127.0.0.1','-uroot','-N','-e','SELECT @@server_uuid')).Output.Trim()
    if($fixtureUuid-notmatch'^[a-f0-9-]{36}$'){throw 'Invalid owned fixture UUID'}
    $environment=@('-e',"MGAEMS_TEST_MYSQL_UUID=$fixtureUuid",'-e','MGAEMS_DISPOSABLE_STAGING=fresh-mysql-fixture','-e',"DB_DATABASE=$databaseName",'-e','DB_HOST=127.0.0.1','-e','DB_PORT=3306',
        '-e','DB_CONNECTION=mysql','-e','DB_USERNAME=root','-e',"DB_PASSWORD=$databasePassword",'-e',"APP_KEY=$appKey",'-e','APP_URL=https://demo.invalid',
        '-e',"MGAEMS_TEST_ADMIN_PASSWORD=$adminPassword",'-e','PORT=8087')
    $base=@('run','--rm','--pull','never','--network',"container:$testId",'--mount',$testMount)+$environment
    foreach($badUuid in @('', '00000000-0000-0000-0000-000000000000')){
        $denied=Run-Docker ($base+@('-e',"MGAEMS_TEST_MYSQL_UUID=$badUuid",'--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--tmpfs','/var/www/html/bootstrap/cache:rw,noexec,nosuid,size=8m',
            '--tmpfs','/var/www/html/storage:rw,noexec,nosuid,size=64m','--entrypoint','php',$stagingImage,'-d','zend.exception_ignore_args=1','/tests/staging_install.php','setup')) $true
        if($denied.ExitCode-eq0-or-not$denied.Diagnostics.Contains('Owned fixture MySQL identity required')){throw 'Missing/wrong fixture identity was not refused'}
        $empty=Run-Docker @('exec','-e',"MYSQL_PWD=$databasePassword",$testId,'mysql','--protocol=TCP','-h','127.0.0.1','-uroot','-N',$databaseName,'-e','SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()')
        if($empty.Output.Trim()-ne'0'){throw 'Refused identity must leave fixture schema empty'}
        Write-Output 'PASS missing/wrong fixture UUID rejected before migration'
    }
    $setup=Run-Docker ($base+@('--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--tmpfs','/var/www/html/bootstrap/cache:rw,noexec,nosuid,size=8m',
        '--tmpfs','/var/www/html/storage:rw,noexec,nosuid,size=64m','--entrypoint','php',$stagingImage,'-d','zend.exception_ignore_args=1','/tests/staging_install.php','setup')) $true
    [IO.File]::WriteAllText((Join-Path $evidencePath 'setup.txt'),$setup.Output+$setup.Diagnostics,$utf8)
    if($setup.ExitCode-ne0-or-not$setup.Output.Contains('PASS setup complete;')){throw 'Fresh installation failed; see protected setup evidence'}
    Write-Output $setup.Output
    Run-Docker @('volume','create','--label',"mgaems.staging-test=$runId",$fileVolume)|Out-Null;$volumeCreated=$true
    $webArgs=@('run','-d','--pull','never','--name',$webName,'--label',"mgaems.staging-test=$runId",'--network',"container:$testId",'--volume',"${fileVolume}:/var/www/html/storage")+$environment+@($stagingImage)
    $webId=(Run-Docker $webArgs).Output.Trim()
    $healthy=$false
    for($attempt=0;$attempt-lt30;$attempt++){
        $probe=Run-Docker @('exec',$webId,'curl','--fail','--silent','http://127.0.0.1:8087/healthz') $true
        if($probe.ExitCode-eq0){$healthy=$true;break};Start-Sleep -Seconds 1
    }
    if(-not$healthy){
        $logs=Run-Docker @('logs',$webId) $true
        [IO.File]::WriteAllText((Join-Path $evidencePath 'startup.txt'),$logs.Output+$logs.Diagnostics,$utf8)
        throw 'Staging HTTP startup failed; protected logs retained'
    }
    $http=Run-Docker ($base+@('--volume',"${fileVolume}:/var/www/html/storage",'--tmpfs','/var/www/html/bootstrap/cache:rw,noexec,nosuid,size=8m',
        '--entrypoint','php',$stagingImage,'-d','zend.exception_ignore_args=1','/tests/staging_install.php','http')) $true
    [IO.File]::WriteAllText((Join-Path $evidencePath 'http.txt'),$http.Output+$http.Diagnostics,$utf8)
    if($http.ExitCode-ne0-or-not$http.Output.Contains('PASS logout invalidates the fixture token')){throw 'Staging HTTP checks failed; protected evidence retained'}
    Write-Output $http.Output
    $exports=Run-Docker ($base+@('--volume',"${fileVolume}:/var/www/html/storage",'--tmpfs','/var/www/html/bootstrap/cache:rw,noexec,nosuid,size=8m',
        '--entrypoint','php',$stagingImage,'-d','zend.exception_ignore_args=1','/tests/staging_install.php','exports')) $true
    [IO.File]::WriteAllText((Join-Path $evidencePath 'exports.txt'),$exports.Output+$exports.Diagnostics,$utf8)
    if($exports.ExitCode-ne0-or-not$exports.Output.Contains('PASS renderer remote fetching and embedded PHP remain disabled')){throw 'Staging PDF/XLSX checks failed; protected evidence retained'}
    Write-Output $exports.Output
    Remove-OwnedContainer $webId $webName;$webId=$null
    $webId=(Run-Docker $webArgs).Output.Trim()
    $persist=Run-Docker ($base+@('--volume',"${fileVolume}:/var/www/html/storage",'--tmpfs','/var/www/html/bootstrap/cache:rw,noexec,nosuid,size=8m',
        '--entrypoint','php',$stagingImage,'/tests/staging_install.php','persist')) $true
    [IO.File]::WriteAllText((Join-Path $evidencePath 'persistence.txt'),$persist.Output+$persist.Diagnostics,$utf8)
    if($persist.ExitCode-ne0-or-not$persist.Output.Contains('PASS private volume survives container replacement')){throw 'Persistence check failed'}
    Write-Output $persist.Output
    # Synthetic full restore. Source and target UUIDs/names/labels are independent.
    $backupVolume="mgaems-stage-recovery-backup-$runId";$restoreVolume="mgaems-stage-recovery-files-$runId"
    $restoreName="mgaems-stage-recovery-mysql-$runId";$restoreWebName="mgaems-stage-recovery-web-$runId"
    $restoreId=$null;$restoreWebId=$null;$createdBackup=$false;$createdRestore=$false
    try{
        $recoveryMount='type=bind,source=D:\mgaems\tests\safe\staging_recovery.php,target=/tests/staging_recovery.php,readonly'
        $recoveryBase=@('run','--rm','--pull','never','--network',"container:$testId",'--mount',$recoveryMount,'--user','www-data','--volume',"${fileVolume}:/var/www/html/storage",'--tmpfs','/tmp:rw,noexec,nosuid,size=64m')+$environment
        $prepared=Run-Docker ($recoveryBase+@('--entrypoint','php',$stagingImage,'-d','zend.exception_ignore_args=1','/tests/staging_recovery.php','prepare')) $true
        [IO.File]::WriteAllText((Join-Path $evidencePath 'recovery-prepare.txt'),$prepared.Output+$prepared.Diagnostics,$utf8)
        if($prepared.ExitCode-ne0-or-not$prepared.Output.Contains('PASS synthetic private upload retained artifact encrypted session and token prepared; key excluded from manifest')){throw 'Recovery fixture preparation failed'}
        Write-Output $prepared.Output
        Run-Docker @('volume','create','--label',"mgaems.staging-test=$runId",$backupVolume)|Out-Null;$createdBackup=$true
        Run-Docker @('volume','create','--label',"mgaems.staging-test=$runId",$restoreVolume)|Out-Null;$createdRestore=$true
        Run-Docker @('run','--rm','--network','none','--volume',"${fileVolume}:/source:ro",'--volume',"${backupVolume}:/backup",'--entrypoint','sh',$stagingImage,'-c','tar -cf /backup/storage.tar -C /source .')|Out-Null
        Run-Docker @('run','--rm','--network',"container:$testId",'--volume',"${backupVolume}:/backup",'-e',"MYSQL_PWD=$databasePassword",'-e',"BACKUP_DB=$databaseName",'--entrypoint','sh',$mysqlImage,'-c','mysqldump --protocol=TCP -h127.0.0.1 -uroot --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --routines --events --triggers --hex-blob --skip-add-locks --skip-comments --skip-lock-tables "$BACKUP_DB" > /backup/database.sql')|Out-Null
        $keyAbsent='foreach (["/backup/database.sql","/backup/storage.tar"] as $file) { if (str_contains(file_get_contents($file),getenv("APP_KEY"))) { fwrite(STDERR,"Key included in backup\n");exit(1); } } echo "PASS independent application key excluded from database and storage archives\n";'
        $exclusion=Run-Docker @('run','--rm','--network','none','--volume',"${backupVolume}:/backup:ro",'-e',"APP_KEY=$appKey",'--entrypoint','php',$stagingImage,'-r',$keyAbsent)
        Write-Output $exclusion.Output
        Remove-OwnedContainer $webId $webName;$webId=$null
        Remove-OwnedContainer $testId $testName;$testId=$null
        $restoreId=(Run-Docker @('run','--pull','never','-d','--name',$restoreName,'--label',"mgaems.staging-test=$runId",'--network','none','--tmpfs','/var/lib/mysql:rw,noexec,nosuid,size=512m','-e',"MYSQL_ROOT_PASSWORD=$databasePassword",'-e',"MYSQL_DATABASE=$databaseName",$mysqlImage)).Output.Trim()
        $restoreActual=((Run-Docker @('inspect',$restoreId)).Output|ConvertFrom-Json)[0]
        if($restoreActual.HostConfig.NetworkMode-ne'none'-or$restoreActual.Mounts.Count){throw 'Recovery target isolation differs'}
        $ready=$false
        for($attempt=0;$attempt-lt60;$attempt++){$probe=Run-Docker @('exec','-e',"MYSQL_PWD=$databasePassword",$restoreId,'mysql','--protocol=TCP','-h127.0.0.1','-uroot','-N','-e','SELECT 1') $true;if($probe.ExitCode-eq0){$ready=$true;break};Start-Sleep -Seconds 1}
        if(-not$ready){throw 'Recovery target unavailable'}
        $restoreUuid=(Run-Docker @('exec','-e',"MYSQL_PWD=$databasePassword",$restoreId,'mysql','--protocol=TCP','-h127.0.0.1','-uroot','-N','-e','SELECT @@server_uuid')).Output.Trim()
        if($restoreUuid-eq$fixtureUuid){throw 'Recovery target must have a new server identity'}
        Run-Docker @('run','--rm','--network',"container:$restoreId",'--volume',"${backupVolume}:/backup:ro",'-e',"MYSQL_PWD=$databasePassword",'-e',"RESTORE_DB=$databaseName",'--entrypoint','sh',$mysqlImage,'-c','mysql --protocol=TCP -h127.0.0.1 -uroot "$RESTORE_DB" < /backup/database.sql')|Out-Null
        Run-Docker @('run','--rm','--network','none','--volume',"${backupVolume}:/backup:ro",'--volume',"${restoreVolume}:/restore",'--entrypoint','sh',$stagingImage,'-c','tar -xf /backup/storage.tar -C /restore')|Out-Null
        $restoredEnvironment=$environment+@('-e',"MGAEMS_TEST_MYSQL_UUID=$restoreUuid")
        $restoreWebId=(Run-Docker (@('run','-d','--name',$restoreWebName,'--label',"mgaems.staging-test=$runId",'--network',"container:$restoreId",'--volume',"${restoreVolume}:/var/www/html/storage")+$restoredEnvironment+@($stagingImage))).Output.Trim()
        $healthy=$false
        for($attempt=0;$attempt-lt30;$attempt++){$probe=Run-Docker @('exec',$restoreWebId,'curl','--fail','--silent','http://127.0.0.1:8087/healthz') $true;if($probe.ExitCode-eq0){$healthy=$true;break};Start-Sleep -Seconds 1}
        if(-not$healthy){throw 'Recovered application did not become ready'}
        Write-Output 'PASS independent database and file volumes restored after source containers removed'
        $restoreBase=@('run','--rm','--pull','never','--network',"container:$restoreId",'--mount',$recoveryMount,'--user','www-data','--volume',"${restoreVolume}:/var/www/html/storage",'--tmpfs','/tmp:rw,noexec,nosuid,size=64m')+$restoredEnvironment
        $wrongKey='base64:'+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runId.PadRight(32,'x')))
        $wrong=Run-Docker ($restoreBase+@('-e',"APP_KEY=$wrongKey",'--entrypoint','php',$stagingImage,'-d','zend.exception_ignore_args=1','/tests/staging_recovery.php','wrong-key')) $true
        [IO.File]::WriteAllText((Join-Path $evidencePath 'recovery-wrong-key.txt'),$wrong.Output+$wrong.Diagnostics,$utf8)
        if($wrong.ExitCode-ne0-or-not$wrong.Output.Contains('PASS wrong key cannot decrypt recovered token or session identity')){throw 'Wrong-key recovery did not fail closed'}
        Write-Output $wrong.Output
        $verified=Run-Docker ($restoreBase+@('--entrypoint','php',$stagingImage,'-d','zend.exception_ignore_args=1','/tests/staging_recovery.php','verify')) $true
        [IO.File]::WriteAllText((Join-Path $evidencePath 'recovery-verify.txt'),$verified.Output+$verified.Diagnostics,$utf8)
        if($verified.ExitCode-ne0-or-not$verified.Output.Contains('PASS restored storage ownership and runtime write permissions work')){throw 'Complete recovery assertions failed'}
        Write-Output $verified.Output
    }finally{
        Remove-OwnedContainer $restoreWebId $restoreWebName;Remove-OwnedContainer $restoreId $restoreName
        foreach($entry in @(@{name=$backupVolume;created=$createdBackup},@{name=$restoreVolume;created=$createdRestore})){if($entry.created){$owned=((Run-Docker @('volume','inspect',$entry.name)).Output|ConvertFrom-Json)[0];if($owned.Name-ne$entry.name-or$owned.Labels.'mgaems.staging-test'-ne$runId){throw 'Recovery volume ownership differs'};Run-Docker @('volume','rm',$entry.name)|Out-Null}}
    }

    Write-Output "PASS isolated staging verification and full recovery; evidence: $evidencePath"
} finally {
    Remove-OwnedContainer $webId $webName
    Remove-OwnedContainer $testId $testName
    if($volumeCreated){
        $volume=((Run-Docker @('volume','inspect',$fileVolume)).Output|ConvertFrom-Json)[0]
        if($volume.Name-ne$fileVolume-or$volume.Labels.'mgaems.staging-test'-ne$runId){throw 'Volume cleanup ownership differs'}
        Run-Docker @('volume','rm',$fileVolume)|Out-Null
    }
    $databasePassword=$null;$adminPassword=$null;$environment=$null;$appKey=$null
}
