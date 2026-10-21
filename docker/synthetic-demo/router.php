<?php

require __DIR__.'/bootstrap.php';
try {
    $app = syntheticDemoApp();
    assertSyntheticDemoIdentity();
} catch (Throwable) {
    http_response_code(503);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'The isolated synthetic demo is not initialized or its identity check failed.']);
    return;
}
header('X-MGAEMS-Synthetic-Demo: original-science-v1');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/' || $path === '/demo') {
    header('Content-Type: text/html; charset=UTF-8');
    readfile(__DIR__.'/welcome.html');
    return;
}
if ($path === '/__demo/ui.js' || $path === '/__demo/style.css') {
    header('Content-Type: '.(str_ends_with($path, '.js') ? 'text/javascript' : 'text/css'));
    readfile(__DIR__.'/'.basename($path));
    return;
}
$public = realpath(dirname(__DIR__, 2).'/public');
$file = realpath($public.'/'.ltrim($path, '/'));
if ($file && str_starts_with($file, $public.DIRECTORY_SEPARATOR) && is_file($file)) {
    $extension = pathinfo($file, PATHINFO_EXTENSION);
    if ($extension === 'html') {
        header('Content-Type: text/html; charset=UTF-8');
        $html = file_get_contents($file);
        echo str_replace('</head>', '<link rel="stylesheet" href="/__demo/style.css"><script src="/__demo/ui.js" defer></script></head>', $html);
        return;
    }
    if (in_array($extension, ['js', 'css', 'png', 'jpg', 'jpeg', 'svg', 'ico', 'woff', 'woff2'], true)) return false;
}
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$request = Illuminate\Http\Request::capture();
$response = $kernel->handle($request);
$response->send();
$kernel->terminate($request, $response);
