$ErrorActionPreference = 'Stop'
if ((Get-Location).Path -ne 'D:\mgaems') { throw 'Run only from D:\mgaems.' }
$testName = 'mgaems-health-corrective-test-' + [guid]::NewGuid().ToString('N')
$testPassword = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$mysqlImage = 'sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b'
$phpImage = 'sha256:23597d93c757711a7b796b5c725e7b80c9df4cf3c9550c745260f80b79611c80'
$testId = $null
try {
    # Cached images only: no pull, host ports, Compose service or persistent DB volume.
    $testId = docker run --pull never -d --name $testName --label mgaems.task=health-corrective-fixtures --network none --tmpfs /var/lib/mysql:rw,noexec,nosuid,size=512m -e "MYSQL_ROOT_PASSWORD=$testPassword" -e MYSQL_DATABASE=mgaems_health_corrective_tests $mysqlImage
    if ($LASTEXITCODE -ne 0) { throw 'Disposable MySQL creation failed.' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        $ErrorActionPreference = 'Continue'
        'SELECT 1;' | docker exec -i $testId sh -c 'MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot --silent' *> $null
        $ErrorActionPreference = 'Stop'
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Disposable MySQL did not become ready.' }
    docker run --pull never --rm --network "container:$testId" --mount 'type=bind,source=D:\mgaems,target=/var/www/html,readonly' --mount type=volume,source=mgaems_mgaems_vendor,target=/var/www/html/vendor,readonly -w /var/www/html -e MGAEMS_DISPOSABLE_MYSQL=health-corrective-fixtures -e "MGAEMS_TEST_MYSQL_PASSWORD=$testPassword" --entrypoint php $phpImage tests/safe/health_mysql.php
    if ($LASTEXITCODE -ne 0) { throw 'Isolated MySQL regressions failed.' }
} finally {
    if ($testId) {
        $owned = (docker inspect $testId | ConvertFrom-Json)[0]
        if ($LASTEXITCODE -eq 0 -and $owned.Id -eq $testId -and $owned.Name -eq "/$testName" -and
            $owned.Config.Labels.'mgaems.task' -eq 'health-corrective-fixtures' -and
            $owned.HostConfig.NetworkMode -eq 'none' -and $owned.HostConfig.Tmpfs.'/var/lib/mysql') {
            docker rm -f $testId | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Disposable MySQL cleanup failed.' }
            Write-Output 'Owned disposable MySQL removed; RAM-only fixtures discarded.'
        } else { throw 'Cleanup refused: disposable container ownership could not be verified.' }
    }
    $testPassword = $null
}
