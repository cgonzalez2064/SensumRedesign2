<?php
declare(strict_types=1);

namespace Sensum\Cms\Content;

/** Loads cms/content/schema.php + defaults.php and answers questions about fields. */
final class Schema
{
    private array $sections;
    /** @var array<string,array> */
    private array $fields = [];
    private array $defaults;

    public function __construct(string $dir)
    {
        $schema = require $dir . '/schema.php';
        $this->defaults = require $dir . '/defaults.php';
        $this->sections = $schema['sections'];
        foreach ($this->sections as $section) {
            foreach ($section['fields'] as $f) {
                $f += ['required' => true, 'bilingual' => true, 'max' => 200];
                $f['section'] = $section['id'];
                $this->fields[$f['key']] = $f;
            }
        }
    }

    public function sections(): array
    {
        return $this->sections;
    }

    public function sectionIds(): array
    {
        return array_column($this->sections, 'id');
    }

    public function field(string $key): ?array
    {
        return $this->fields[$key] ?? null;
    }

    /** @return array<string,array> */
    public function fields(): array
    {
        return $this->fields;
    }

    /** @return array<string,array> fields of one section */
    public function sectionFields(string $id): array
    {
        return array_filter($this->fields, fn ($f) => $f['section'] === $id);
    }

    /** Default value; $lang is 'es'/'en' for bilingual fields, '*' otherwise. */
    public function default(string $key, string $lang): string
    {
        $f = $this->fields[$key] ?? null;
        if (!$f) {
            return '';
        }
        if (!$f['bilingual']) {
            return (string) ($f['default'] ?? '');
        }
        return (string) ($this->defaults[$lang][$key] ?? '');
    }
}
