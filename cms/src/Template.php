<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Deliberately tiny, logic-less template renderer for the public pages.
 *
 *   {{name}}                      inserts $vars[name] (already HTML-safe — the
 *                                 Publisher escapes every value it provides)
 *   {{#if flag}}A{{else}}B{{/if}} inserts A when $flags[flag] is truthy, else B
 *
 * Templates cannot run code, and values are inserted in a single pass, so a
 * value that happens to contain "{{…}}" is never re-interpreted. Unknown
 * placeholders abort rendering (the live site is then left untouched).
 */
final class Template
{
    public static function render(string $tpl, array $vars, array $flags = []): string
    {
        $out = preg_replace_callback(
            '/\{\{#if ([A-Za-z0-9_.:\-]+)\}\}(.*?)(?:\{\{else\}\}(.*?))?\{\{\/if\}\}/s',
            static fn (array $m) => !empty($flags[$m[1]]) ? $m[2] : ($m[3] ?? ''),
            $tpl
        );
        // Unbalanced or nested blocks are template bugs: refuse to publish.
        if ($out === null || preg_match('/\{\{(#if |else\}\}|\/if\}\})/', $out)) {
            throw new \RuntimeException('template_block_error');
        }
        $out = preg_replace_callback(
            '/\{\{([A-Za-z0-9_.:\-]+)\}\}/',
            static function (array $m) use ($vars): string {
                if (!array_key_exists($m[1], $vars)) {
                    throw new \RuntimeException('template_unknown_placeholder:' . $m[1]);
                }
                return (string) $vars[$m[1]];
            },
            $out
        );
        if ($out === null) {
            throw new \RuntimeException('template_render_error');
        }
        return $out;
    }
}
