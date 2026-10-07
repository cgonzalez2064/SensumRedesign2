<?php
declare(strict_types=1);

namespace Sensum\Cms\Content;

use Sensum\Cms\Db;

/**
 * Reads/writes editable values. Fields without a stored row use the approved
 * defaults from cms/content/defaults.php (or the schema for business details).
 */
final class ContentRepository
{
    public function __construct(private Db $db, private Schema $schema)
    {
    }

    /** @return array<string,array{es?:string,en?:string,'*'?:string}> current values for every field */
    public function values(): array
    {
        $out = [];
        foreach ($this->schema->fields() as $key => $f) {
            foreach ($this->langs($f) as $lang) {
                $out[$key][$lang] = $this->schema->default($key, $lang);
            }
        }
        foreach ($this->db->all('SELECT key, lang, value FROM content') as $row) {
            if (isset($out[$row['key']]) && array_key_exists($row['lang'], $out[$row['key']])) {
                $out[$row['key']][$row['lang']] = (string) $row['value'];
            }
        }
        return $out;
    }

    public function value(string $key, string $lang = 'es'): string
    {
        $f = $this->schema->field($key);
        if (!$f) {
            return '';
        }
        $l = $f['bilingual'] ? $lang : '*';
        $v = $this->db->value('SELECT value FROM content WHERE key = ? AND lang = ?', [$key, $l]);
        return $v === null ? $this->schema->default($key, $l) : (string) $v;
    }

    /** Latest change in a section (optimistic-concurrency token for the editor). */
    public function sectionVersion(string $sectionId): int
    {
        $keys = array_keys($this->schema->sectionFields($sectionId));
        if (!$keys) {
            return 0;
        }
        $in = implode(',', array_fill(0, count($keys), '?'));
        return (int) ($this->db->value("SELECT MAX(updated_at) FROM content WHERE key IN ($in)", $keys) ?? 0);
    }

    public function sectionUpdatedBy(string $sectionId): ?array
    {
        $keys = array_keys($this->schema->sectionFields($sectionId));
        if (!$keys) {
            return null;
        }
        $in = implode(',', array_fill(0, count($keys), '?'));
        return $this->db->one("SELECT c.updated_at, u.name FROM content c LEFT JOIN users u ON u.id = c.updated_by WHERE c.key IN ($in) ORDER BY c.updated_at DESC LIMIT 1", $keys);
    }

    /**
     * Saves already-validated values. Returns the list of keys that changed.
     * @param array<string,array<string,string>> $values key => [lang => value]
     */
    public function save(array $values, int $userId): array
    {
        $now = time();
        $changed = [];
        $this->db->transaction(function () use ($values, $userId, $now, &$changed) {
            foreach ($values as $key => $langs) {
                foreach ($langs as $lang => $value) {
                    $current = $this->value($key, $lang === '*' ? 'es' : $lang);
                    if ($current === $value) {
                        continue;
                    }
                    $changed[] = $key . ($lang === '*' ? '' : ".$lang");
                    // A row is kept even when a value returns to its default so the
                    // section's "last changed by / at" information stays accurate.
                    $this->db->run('DELETE FROM content WHERE key = ? AND lang = ?', [$key, $lang]);
                    $this->db->run(
                        'INSERT INTO content (key, lang, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)',
                        [$key, $lang, $value, $now, $userId]
                    );
                }
            }
        });
        return $changed;
    }

    /** @return list<string> */
    public function langs(array $field): array
    {
        return $field['bilingual'] ? ['es', 'en'] : ['*'];
    }
}
