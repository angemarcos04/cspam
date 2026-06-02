<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class QueueDiagnosticsTest extends TestCase
{
    public function test_queue_diagnostics_are_disabled_without_token_configuration(): void
    {
        config()->set('diagnostics.queue.token', null);

        $this->getJson('/api/ops/queue-diagnostics?token=anything')
            ->assertNotFound();
    }

    public function test_queue_diagnostics_require_matching_token(): void
    {
        config()->set('diagnostics.queue.token', 'correct-token');

        $this->getJson('/api/ops/queue-diagnostics?token=wrong-token')
            ->assertNotFound();
    }

    public function test_queue_diagnostics_report_counts_without_payloads(): void
    {
        config()->set('diagnostics.queue.token', 'diagnostic-token');
        config()->set('queue.default', 'database');
        config()->set('auth_mfa.monitor.queue', 'mail');
        config()->set('auth_mfa.monitor.delivery_mode', 'sync');
        config()->set('mail.default', 'smtp');
        config()->set('mail.from.address', 'cspams.local@gmail.com');
        config()->set('mail.mailers.smtp.host', 'smtp.gmail.com');
        config()->set('mail.mailers.smtp.port', 587);
        config()->set('mail.mailers.smtp.scheme', 'smtp');
        config()->set('mail.mailers.smtp.username', 'cspams.local@gmail.com');
        config()->set('mail.mailers.smtp.password', 'secret-app-password');

        $this->withQueueDatabase(function (): void {
            DB::table('jobs')->insert([
                'queue' => 'mail',
                'payload' => '{"secret":"123456"}',
                'attempts' => 0,
                'reserved_at' => null,
                'available_at' => 1710000000,
                'created_at' => 1710000000,
            ]);
            DB::table('failed_jobs')->insert([
                'uuid' => 'failed-mail-job',
                'connection' => 'database',
                'queue' => 'mail',
                'payload' => '{"secret":"654321"}',
                'exception' => 'Swift_TransportException: SMTP rejected login password=secret-value',
                'failed_at' => '2026-06-02 12:00:00',
            ]);

            $response = $this->getJson('/api/ops/queue-diagnostics?token=diagnostic-token')
                ->assertOk()
                ->assertJsonPath('queueConnection', 'database')
                ->assertJsonPath('mfa.deliveryMode', 'sync')
                ->assertJsonPath('mail.mailer', 'smtp')
                ->assertJsonPath('mail.smtpHost', 'smtp.gmail.com')
                ->assertJsonPath('mail.smtpPasswordConfigured', true)
                ->assertJsonPath('mailQueue', 'mail')
                ->assertJsonPath('jobs.total', 1)
                ->assertJsonPath('jobs.byQueue.0.queue', 'mail')
                ->assertJsonPath('failedJobs.total', 1)
                ->assertJsonPath('failedJobs.recent.0.exceptionSummary', 'Swift_TransportException: SMTP rejected login password=[redacted]');

            $this->assertStringNotContainsString('123456', $response->getContent());
            $this->assertStringNotContainsString('654321', $response->getContent());
            $this->assertStringNotContainsString('secret-app-password', $response->getContent());
        });
    }

    private function withQueueDatabase(callable $callback): void
    {
        $originalDefault = (string) config('database.default');

        config([
            'database.connections.queue_diagnostics_test' => [
                'driver' => 'sqlite',
                'database' => ':memory:',
                'prefix' => '',
                'foreign_key_constraints' => true,
            ],
            'database.default' => 'queue_diagnostics_test',
        ]);

        DB::setDefaultConnection('queue_diagnostics_test');
        DB::purge('queue_diagnostics_test');
        DB::reconnect('queue_diagnostics_test');

        Schema::connection('queue_diagnostics_test')->create('jobs', static function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->string('queue')->index();
            $table->longText('payload');
            $table->unsignedTinyInteger('attempts');
            $table->unsignedInteger('reserved_at')->nullable();
            $table->unsignedInteger('available_at');
            $table->unsignedInteger('created_at');
        });

        Schema::connection('queue_diagnostics_test')->create('failed_jobs', static function (Blueprint $table): void {
            $table->id();
            $table->string('uuid')->unique();
            $table->text('connection');
            $table->text('queue');
            $table->longText('payload');
            $table->longText('exception');
            $table->timestamp('failed_at')->nullable();
        });

        try {
            $callback();
        } finally {
            config(['database.default' => $originalDefault]);
            DB::setDefaultConnection($originalDefault);
            DB::purge('queue_diagnostics_test');
        }
    }
}
