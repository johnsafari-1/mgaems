# Configuration-only validation; never starts Compose services.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('mgaems-compose-'+[Guid]::NewGuid().ToString('N')+'.env')
$keys=@('MGAEMS_DOCKER_DB_DATABASE','MGAEMS_DOCKER_DB_USERNAME','MGAEMS_DOCKER_DB_PASSWORD','MGAEMS_DOCKER_ROOT_PASSWORD','MGAEMS_DOCKER_MYSQL_PORT')
$original=@{};foreach($key in $keys){$original[$key]=[Environment]::GetEnvironmentVariable($key,'Process');[Environment]::SetEnvironmentVariable($key,$null,'Process')}
function Probe-Compose {
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName='docker.exe';$info.Arguments='compose --project-directory "'+$root+'" --env-file "'+$temporary+'" -f "'+$root+'\compose.yaml" config --format json'
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process;$process.StartInfo=$info;$process.Start()|Out-Null
    $output=$process.StandardOutput.ReadToEndAsync();$errors=$process.StandardError.ReadToEndAsync();$process.WaitForExit()
    $result=@{exit=$process.ExitCode;output=$output.GetAwaiter().GetResult();errors=$errors.GetAwaiter().GetResult()};$process.Dispose();return $result
}
try {
    $fixture="MGAEMS_DOCKER_DB_DATABASE=mgaems_config_test`nMGAEMS_DOCKER_DB_USERNAME=placeholder_app`nMGAEMS_DOCKER_DB_PASSWORD='placeholder_app_`$literal#colon:'`nMGAEMS_DOCKER_ROOT_PASSWORD=placeholder_root_only`nMGAEMS_DOCKER_MYSQL_PORT=3308`n"
    [IO.File]::WriteAllText($temporary,$fixture,(New-Object Text.UTF8Encoding($false)))
    $probe=Probe-Compose;if($probe.exit-ne0){throw 'Placeholder Compose validation failed'}
    $config=$probe.output|ConvertFrom-Json;$app=$config.services.app;$mysql=$config.services.mysql
    # Compose JSON serialization doubles literal dollars for a reusable config.
    if($app.environment.DB_PASSWORD-ne'placeholder_app_$$literal#colon:'-or$mysql.environment.MYSQL_PASSWORD-ne$app.environment.DB_PASSWORD){throw 'Compose interpolation/quoting differs'}
    'PASS placeholder quoting and shared application credentials'
    if($app.environment.MYSQL_ROOT_PASSWORD-or$app.environment.MGAEMS_DOCKER_ROOT_PASSWORD-or$mysql.environment.MYSQL_ROOT_PASSWORD-ne'placeholder_root_only'){throw 'Root credential crosses application environment'}
    'PASS root credential stays out of application environment'
    if($app.environment.DB_HOST-ne'mysql'-or$app.environment.DB_PORT-ne'3306'-or$mysql.ports[0].host_ip-ne'127.0.0.1'-or$mysql.ports[0].published-ne'3308'-or$mysql.ports[0].target-ne3306){throw 'Internal/loopback network contract differs'}
    'PASS loopback host binding and internal mysql:3306 contract'
    if($config.volumes.mgaems_mysql_data.name-ne'mgaems_mgaems_mysql_data'-or$config.volumes.mgaems_vendor.name-ne'mgaems_mgaems_vendor'){throw 'Existing volume identities differ'}
    'PASS existing MySQL and vendor volume identities preserved'
    if($mysql.healthcheck.test[1]-notlike'*MYSQL_PWD="$${MYSQL_ROOT_PASSWORD}"*'-or$mysql.healthcheck.test[1]-notlike'*SELECT 1*'-or$mysql.healthcheck.test[1]-like'*placeholder_root_only*'-or$mysql.healthcheck.test[1]-match'--password=|-p\$'){throw 'Health check exposes passwords or does not verify authentication'}
    'PASS authenticated health check references runtime password without argv literal'
    foreach($missing in @('MGAEMS_DOCKER_DB_PASSWORD','MGAEMS_DOCKER_ROOT_PASSWORD','MGAEMS_DOCKER_DB_USERNAME')) {
        [IO.File]::WriteAllText($temporary,([regex]::Replace($fixture,"(?m)^$missing=.*$", "$missing=")),(New-Object Text.UTF8Encoding($false)))
        $denied=Probe-Compose;if($denied.exit-eq0-or-not$denied.errors.Contains($missing)){throw 'Missing credential did not fail closed'}
    }
    'PASS missing application/root credentials and username fail before service operations'
} finally {
    foreach($key in $keys){[Environment]::SetEnvironmentVariable($key,$original[$key],'Process')}
    if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}
}
