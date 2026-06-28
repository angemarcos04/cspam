<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('notifications', function (Blueprint $table): void {
            $table->timestamp('cleared_at')->nullable()->after('read_at');
            $table->index(
                ['notifiable_type', 'notifiable_id', 'cleared_at', 'created_at'],
                'notifications_visible_idx'
            );
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table): void {
            $table->dropIndex('notifications_visible_idx');
            $table->dropColumn('cleared_at');
        });
    }
};
