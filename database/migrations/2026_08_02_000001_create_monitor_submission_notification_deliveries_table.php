<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('monitor_submission_notification_deliveries', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('recipient_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('submission_id')->constrained('indicator_submissions')->cascadeOnDelete();
            $table->char('notification_key', 64);
            $table->string('event_type', 80);
            $table->json('scope_ids')->nullable();
            $table->timestamps();

            $table->unique(
                ['recipient_id', 'notification_key'],
                'monitor_submission_notification_delivery_unique',
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('monitor_submission_notification_deliveries');
    }
};
