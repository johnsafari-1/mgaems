$ErrorActionPreference = 'Stop'
if ((Get-Location).Path -ne 'D:\mgaems') { throw 'Run only from D:\mgaems.' }
$fixtureName = 'mgaems-staff-links-test-' + [guid]::NewGuid().ToString('N')
$fixturePassword = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$mysqlImage = 'sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b'
$phpImage = 'sha256:23597d93c757711a7b796b5c725e7b80c9df4cf3c9550c745260f80b79611c80'
$fixtureId = $null
try {
    $fixtureId = docker run --pull never -d --name $fixtureName --label mgaems.task=staff-account-links --network none --tmpfs /var/lib/mysql:rw,noexec,nosuid,size=512m -e "MYSQL_ROOT_PASSWORD=$fixturePassword" -e MYSQL_DATABASE=mgaems_staff_link_tests $mysqlImage
    if ($LASTEXITCODE -ne 0) { throw 'Disposable MySQL creation failed.' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        $ErrorActionPreference = 'Continue'
        'SELECT 1;' | docker exec -i $fixtureId sh -c 'MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql --protocol=TCP -h127.0.0.1 -uroot --silent' *> $null
        $ErrorActionPreference = 'Stop'
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Disposable MySQL readiness failed.' }
    docker run --pull never --rm --network "container:$fixtureId" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --mount 'type=bind,source=D:\mgaems,target=/var/www/html,readonly' --mount type=volume,source=mgaems_mgaems_vendor,target=/var/www/html/vendor,readonly -w /var/www/html -e MGAEMS_DISPOSABLE_MYSQL=staff-account-links -e "MGAEMS_TEST_MYSQL_PASSWORD=$fixturePassword" --entrypoint php $phpImage -d zend.exception_ignore_args=1 tests/safe/staff_account_links_mysql.php
    if ($LASTEXITCODE -ne 0) { throw 'Isolated MySQL account-link checks failed.' }
} finally {
    if ($fixtureId) {
        $owned = (docker inspect $fixtureId | ConvertFrom-Json)[0]
        if ($LASTEXITCODE -eq 0 -and $owned.Id -eq $fixtureId -and $owned.Name -eq "/$fixtureName" -and
            $owned.Config.Labels.'mgaems.task' -eq 'staff-account-links' -and
            $owned.HostConfig.NetworkMode -eq 'none' -and $owned.HostConfig.Tmpfs.'/var/lib/mysql') {
            docker rm -f $fixtureId | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Disposable MySQL cleanup failed.' }
            Write-Output 'Owned disposable MySQL removed; RAM-only fixtures discarded.'
        } else { throw 'Cleanup refused: disposable container ownership not verified.' }
    }
    $fixturePassword = $null
}
