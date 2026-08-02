<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('monitor_submission_notification_deliveries', function (Blueprint $table): void {
            $table->uuid('notification_id')->nullable();
            $table->index('notification_id', 'monitor_submission_notification_id_idx');
            $table->timestamp('delivered_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('monitor_submission_notification_deliveries', function (Blueprint $table): void {
            $table->dropIndex('monitor_submission_notification_id_idx');
            $table->dropColumn(['notification_id', 'delivered_at']);
        });
    }
};
