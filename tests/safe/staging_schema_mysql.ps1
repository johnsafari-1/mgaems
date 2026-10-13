param([string]$Image='mgaems-staging:security2b',[string]$LegacyImage='mgaems-staging:review')
$ErrorActionPreference='Stop'
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

$runId=[Guid]::NewGuid().ToString('N').Substring(0,8)
$testName="mgaems-stage-schema-$runId";$webName="mgaems-stage-schema-cli-$runId";$fileVolume="mgaems-stage-schema-files-$runId"
$testId=$null;$volumeCreated=$false
$databasePassword=New-FixtureSecret;$adminPassword=New-FixtureSecret
$databaseName="mgaems_stage_test_$runId"
$appKey='base64:'+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runId.PadRight(32,'s')))
$sourceRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if($sourceRoot-ne'D:\mgaems'){throw 'Unexpected source workspace'}
$evidencePath=Join-Path $sourceRoot "storage/app/private/schema-check-$runId"
New-Item -ItemType Directory -Path $evidencePath | Out-Null
$testScript=Join-Path $PSScriptRoot 'staging_schema.php'
try{
 $mysqlImage=((Run-Docker @('image','inspect','mysql:8.0')).Output|ConvertFrom-Json)[0].Id
 $legacyId=((Run-Docker @('image','inspect',$LegacyImage)).Output|ConvertFrom-Json)[0].Id
 $currentId=((Run-Docker @('image','inspect',$Image)).Output|ConvertFrom-Json)[0].Id
 $testId=(Run-Docker @('run','--pull','never','-d','--name',$testName,'--label',"mgaems.staging-test=$runId",'--network','none',
  '--tmpfs','/var/lib/mysql:rw,noexec,nosuid,size=512m','-e',"MYSQL_ROOT_PASSWORD=$databasePassword",'-e',"MYSQL_DATABASE=$databaseName",$mysqlImage)).Output.Trim()
 $actual=((Run-Docker @('inspect',$testId)).Output|ConvertFrom-Json)[0]
 if($actual.HostConfig.NetworkMode-ne'none'-or$actual.Mounts.Count-or$actual.HostConfig.Tmpfs.'/var/lib/mysql'-notlike'*size=512m*'){throw 'Fixture isolation failed'}
 $ready=$false
 for($attempt=0;$attempt-lt60;$attempt++){
  $probe=Run-Docker @('exec','-e',"MYSQL_PWD=$databasePassword",$testId,'mysql','--protocol=TCP','-h','127.0.0.1','-uroot','-N','-e','SELECT 1') $true
  if($probe.ExitCode-eq0){$ready=$true;break};Start-Sleep -Seconds 1
 }
 if(-not$ready){throw 'Fixture MySQL unavailable'}
 $fixtureUuid=(Run-Docker @('exec','-e',"MYSQL_PWD=$databasePassword",$testId,'mysql','--protocol=TCP','-h','127.0.0.1','-uroot','-N','-e','SELECT @@server_uuid')).Output.Trim()
 if($fixtureUuid-notmatch'^[a-f0-9-]{36}$'){throw 'Invalid owned fixture UUID'}
 Run-Docker @('volume','create','--label',"mgaems.staging-test=$runId",$fileVolume)|Out-Null;$volumeCreated=$true
 $argumentsBase=@('run','--rm','--pull','never','--network',"container:$testId",'--mount',"type=bind,source=$testScript,target=/tests/staging_schema.php,readonly",
  '--volume',"${fileVolume}:/var/www/html/storage",'--tmpfs','/var/www/html/bootstrap/cache:rw,noexec,nosuid,size=16m','--tmpfs','/tmp:rw,noexec,nosuid,size=64m',
  '-e',"MGAEMS_TEST_MYSQL_UUID=$fixtureUuid",'-e','MGAEMS_DISPOSABLE_STAGING=fresh-mysql-fixture','-e',"DB_DATABASE=$databaseName",'-e','DB_HOST=127.0.0.1','-e','DB_PORT=3306','-e','DB_CONNECTION=mysql',
  '-e','DB_USERNAME=root','-e',"DB_PASSWORD=$databasePassword",'-e',"APP_KEY=$appKey",'-e','APP_URL=https://demo.invalid','-e',"MGAEMS_TEST_ADMIN_PASSWORD=$adminPassword",'--entrypoint','php')
 foreach($mode in @('baseline','upgrade')){
  $stageImage=if($mode-eq'baseline'){$legacyId}else{$currentId}
  $result=Run-Docker ($argumentsBase+@($stageImage,'-d','zend.exception_ignore_args=1','/tests/staging_schema.php',$mode)) $true
  [IO.File]::WriteAllText((Join-Path $evidencePath "$mode.txt"),$result.Output+$result.Diagnostics,(New-Object Text.UTF8Encoding($false)))
  if($result.ExitCode-ne0-or($mode-eq'baseline'-and-not$result.Output.Contains('one synthetic token'))-or($mode-eq'upgrade'-and-not$result.Output.Contains('PASS existing-schema compatibility used no school-record fixtures'))){throw "Schema $mode failed; protected fixture evidence retained"}
  Write-Output $result.Output
 }
}finally{
 Remove-OwnedContainer $testId $testName
 if($volumeCreated){
  $owned=((Run-Docker @('volume','inspect',$fileVolume)).Output|ConvertFrom-Json)[0]
  if($owned.Name-ne$fileVolume-or$owned.Labels.'mgaems.staging-test'-ne$runId){throw 'File-volume ownership changed'}
  Run-Docker @('volume','rm',$fileVolume)|Out-Null
 }
 $databasePassword=$null;$adminPassword=$null;$appKey=$null;$argumentsBase=$null
}
