<?php

return [
    'default' => env('CACHE_DRIVER', 'file'),
    'serializable_classes' => false,

    'stores' => [
        'file' => [
            'driver' => 'file',
            'path' => storage_path('framework/cache/data'),
        ],
        'database' => [
            'driver' => 'database',
            'table' => 'cache',
            'connection' => null,
        ],
    ],

    'prefix' => env('CACHE_PREFIX', 'mgaems_cache'),
];
