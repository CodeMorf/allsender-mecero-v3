<?php

require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$o = App\Models\Order::find(752);
echo "Order 752 order_type: " . var_export($o->order_type, true) . "\n";
echo "Order 752 order_type_id: " . var_export($o->order_type_id, true) . "\n";
if ($o->orderType) {
    echo "Order 752 orderType relation: " . json_encode($o->orderType->toArray()) . "\n";
}
