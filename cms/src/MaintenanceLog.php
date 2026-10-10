<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Monthly counts of the maintenance the system does on its own — backups,
 * file-integrity checks, certificate checks, Google speed measurements,
 * alerts sent — so the monthly client report can show the work behind the
 * maintenance service. One small settings row, last 24 months only.
 */
final class MaintenanceLog
{
    private const KEY = 'maintenance_log';
    public const ITEMS = ['backups', 'integrity', 'certificate', 'pagespeed', 'alerts', 'dns', 'offsite'];

    public function __construct(private App $app)
    {
    }

    public function add(string $item, int $n = 1, ?int $at = null): void
    {
        if (!in_array($item, self::ITEMS, true) || $n < 1) {
            return;
        }
        try {
            $this->app->db()->transaction(function () use ($item, $n, $at) {
                $log = $this->app->settings()->getJson(self::KEY);
                $month = date('Y-m', $at ?? time());
                $log[$month][$item] = (int) ($log[$month][$item] ?? 0) + $n;
                krsort($log);
                $this->app->settings()->setJson(self::KEY, array_slice($log, 0, 24, true));
            });
        } catch (\Throwable) {
            // statistics only: never break the task that was counted
        }
    }

    /** @return array<string,int> counts for a month ("2026-10") */
    public function month(string $period): array
    {
        $row = $this->app->settings()->getJson(self::KEY)[$period] ?? [];
        $out = [];
        foreach (self::ITEMS as $item) {
            $out[$item] = (int) ($row[$item] ?? 0);
        }
        return $out;
    }
}
