#!/bin/sh
set -eu
umask 027
php /usr/local/bin/validate-staging.php

# Only prepare runtime directories; never migrate, seed or create accounts here.
for directory in \
  storage/app/private storage/app/public storage/framework/cache/data \
  storage/framework/cache/dompdf storage/framework/sessions storage/framework/views \
  storage/logs storage/fonts bootstrap/cache; do
  mkdir -p "$directory"
  chown www-data:www-data "$directory"
  chmod 2770 "$directory"
done
test ! -e public/storage || test -L public/storage
if [ ! -L public/storage ]; then ln -s /var/www/html/storage/app/public public/storage; fi

# PORT has already been validated as an integer. No secrets enter Apache config.
sed "s/\${PORT}/${PORT}/g" /etc/apache2/sites-available/000-default.conf.template \
  > /etc/apache2/sites-available/000-default.conf
printf '# Port is defined in the staging virtual host.\n' > /etc/apache2/ports.conf
cat > /etc/apache2/conf-enabled/zz-staging-workers.conf <<'APACHE'
<IfModule mpm_prefork_module>
    StartServers 1
    MinSpareServers 1
    MaxSpareServers 2
    MaxRequestWorkers 4
    MaxConnectionsPerChild 1000
</IfModule>
APACHE
php artisan config:cache --no-interaction
php artisan view:cache --no-interaction
exec docker-php-entrypoint apache2-foreground
