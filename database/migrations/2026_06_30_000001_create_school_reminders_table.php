<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('school_reminders', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sent_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();
            $table->unsignedInteger('recipient_count')->default(0);
            $table->json('recipient_domains')->nullable();
            $table->string('dashboard_status', 32)->default('sent');
            $table->string('email_status', 32)->default('skipped');
            $table->string('delivery_mode', 32)->default('queued');
            $table->string('delivery_status', 32)->default('sent');
            $table->text('delivery_warning')->nullable();
            $table->text('email_warning')->nullable();
            $table->timestamps();

            $table->index(['school_id', 'created_at']);
            $table->index(['delivery_status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('school_reminders');
    }
};
