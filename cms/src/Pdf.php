<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Minimal PDF writer for the monthly report: Letter pages, the two standard
 * Helvetica fonts (WinAnsi encoding, so Spanish accents work without
 * embedding a font file), filled and rounded rectangles, lines, triangles,
 * one raster image (converted to JPEG with GD) and link areas.
 *
 * No external library and nothing taken from the input is interpreted:
 * every string is converted to Windows-1252 and escaped. Coordinates are in
 * points measured from the top-left corner of the page; text positions are
 * the baseline.
 */
final class Pdf
{
    public const WIDTH = 612.0;  // US Letter, the paper size used in Guatemala
    public const HEIGHT = 792.0;

    /** Glyph widths (1/1000 em) for bytes 32–255 of Windows-1252 — Helvetica-compatible metrics. */
    private const W_REGULAR = [
        278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278,
        584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
        667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
        278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 750, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
        0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556,
        584, 333, 737, 552, 400, 549, 333, 333, 333, 576, 537, 333, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722,
        667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556,
        556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 549, 611, 556, 556, 556, 556, 500, 556, 500,
    ];
    private const W_BOLD = [
        278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333,
        584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
        667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556,
        333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 750, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
        0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556,
        584, 333, 737, 552, 400, 549, 333, 333, 333, 576, 556, 333, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722,
        667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556,
        556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 549, 611, 611, 611, 611, 611, 556, 611, 556,
    ];

    /** @var list<string> drawing operators of each page */
    private array $pages = [];
    /** @var list<list<array{0:float,1:float,2:float,3:float,4:string}>> link areas per page */
    private array $links = [];
    /** @var list<array{data:string,w:int,h:int}> */
    private array $images = [];
    /** Index of the page being drawn on. */
    private int $current = -1;

    public function __construct(private string $title = '')
    {
    }

    public function addPage(): int
    {
        $this->pages[] = '';
        $this->links[] = [];
        $this->current = count($this->pages) - 1;
        return count($this->pages);
    }

    public function pageCount(): int
    {
        return count($this->pages);
    }

    /** Draws on an earlier page (e.g. "page 1 of 3" footers once the total is known). */
    public function onPage(int $number, callable $draw): void
    {
        if (!isset($this->pages[$number - 1])) {
            return;
        }
        $previous = $this->current;
        $this->current = $number - 1;
        $draw($this);
        $this->current = $previous;
    }

    public static function encode(string $utf8): string
    {
        // Characters outside Windows-1252 that reports may contain.
        $utf8 = strtr($utf8, ['≥' => '>=', '≤' => '<=', '→' => '->', '▲' => '', '▼' => '', "\u{2009}" => ' ', "\u{202F}" => ' ', "\u{00A0}" => ' ']);
        return (string) preg_replace('/[\x00-\x1F\x7F]/', '', mb_convert_encoding($utf8, 'Windows-1252', 'UTF-8'));
    }

    public function width(string $utf8, float $size, bool $bold = false): float
    {
        $table = $bold ? self::W_BOLD : self::W_REGULAR;
        $w = 0;
        $s = self::encode($utf8);
        for ($i = 0, $n = strlen($s); $i < $n; $i++) {
            $c = ord($s[$i]);
            $w += $c >= 32 ? ($table[$c - 32] ?: 556) : 0;
        }
        return $w * $size / 1000;
    }

    /** @return list<string> the text split into lines no wider than $max */
    public function wrap(string $text, float $max, float $size, bool $bold = false): array
    {
        $lines = [];
        foreach (preg_split('/\R/u', $text) ?: [] as $paragraph) {
            $line = '';
            foreach (preg_split('/\s+/u', trim($paragraph)) ?: [] as $word) {
                if ($word === '') {
                    continue;
                }
                $try = $line === '' ? $word : $line . ' ' . $word;
                if ($this->width($try, $size, $bold) <= $max) {
                    $line = $try;
                    continue;
                }
                if ($line !== '') {
                    $lines[] = $line;
                }
                // A word longer than the line (a long address): break it.
                while ($this->width($word, $size, $bold) > $max && mb_strlen($word) > 1) {
                    $cut = mb_strlen($word) - 1;
                    while ($cut > 1 && $this->width(mb_substr($word, 0, $cut), $size, $bold) > $max) {
                        $cut--;
                    }
                    $lines[] = mb_substr($word, 0, $cut);
                    $word = mb_substr($word, $cut);
                }
                $line = $word;
            }
            $lines[] = $line;
        }
        return $lines;
    }

    /** @param 'left'|'right'|'center' $align */
    public function text(float $x, float $y, string $text, float $size, string $color = '#1f2328', bool $bold = false, string $align = 'left'): void
    {
        if ($align !== 'left') {
            $w = $this->width($text, $size, $bold);
            $x -= $align === 'right' ? $w : $w / 2;
        }
        $this->op(sprintf('BT /%s %s Tf %s rg %s %s Td (%s) Tj ET', $bold ? 'F2' : 'F1', self::n($size), $this->rgb($color),
            self::n($x), self::n(self::HEIGHT - $y), self::escape(self::encode($text))));
    }

    /**
     * Wrapped paragraph; returns the y of the line after it.
     */
    public function paragraph(float $x, float $y, float $maxWidth, string $text, float $size, string $color = '#1f2328', bool $bold = false, float $leading = 1.4): float
    {
        foreach ($this->wrap($text, $maxWidth, $size, $bold) as $line) {
            $this->text($x, $y, $line, $size, $color, $bold);
            $y += $size * $leading;
        }
        return $y;
    }

    public function rect(float $x, float $y, float $w, float $h, ?string $fill, ?string $stroke = null, float $radius = 0, float $lineWidth = 0.75): void
    {
        $b = self::HEIGHT - $y - $h; // bottom in PDF space
        if ($radius > 0) {
            $r = min($radius, $w / 2, $h / 2);
            $k = $r * 0.5523;
            $path = sprintf('%s %s m %s %s l %s %s %s %s %s %s c %s %s l %s %s %s %s %s %s c %s %s l %s %s %s %s %s %s c %s %s l %s %s %s %s %s %s c h',
                ...array_map([self::class, 'n'], [
                    $x + $r, $b,
                    $x + $w - $r, $b, $x + $w - $r + $k, $b, $x + $w, $b + $r - $k, $x + $w, $b + $r,
                    $x + $w, $b + $h - $r, $x + $w, $b + $h - $r + $k, $x + $w - $r + $k, $b + $h, $x + $w - $r, $b + $h,
                    $x + $r, $b + $h, $x + $r - $k, $b + $h, $x, $b + $h - $r + $k, $x, $b + $h - $r,
                    $x, $b + $r, $x, $b + $r - $k, $x + $r - $k, $b, $x + $r, $b,
                ]));
        } else {
            $path = sprintf('%s %s %s %s re', self::n($x), self::n($b), self::n($w), self::n($h));
        }
        $this->paint($path, $fill, $stroke, $lineWidth);
    }

    public function line(float $x1, float $y1, float $x2, float $y2, string $color = '#e3e3e8', float $width = 0.75): void
    {
        $this->op(sprintf('%s w %s RG %s %s m %s %s l S', self::n($width), $this->rgb($color),
            self::n($x1), self::n(self::HEIGHT - $y1), self::n($x2), self::n(self::HEIGHT - $y2)));
    }

    /** Small trend triangle centred on (x, y): up or down. */
    public function triangle(float $x, float $y, float $size, bool $up, string $color): void
    {
        $h = $size * 0.85;
        $py = self::HEIGHT - $y;
        $pts = $up
            ? [$x - $size / 2, $py - $h / 2, $x + $size / 2, $py - $h / 2, $x, $py + $h / 2]
            : [$x - $size / 2, $py + $h / 2, $x + $size / 2, $py + $h / 2, $x, $py - $h / 2];
        $this->paint(vsprintf('%s %s m %s %s l %s %s l h', array_map([self::class, 'n'], $pts)), $color, null, 0);
    }

    public function circle(float $cx, float $cy, float $r, string $fill): void
    {
        $this->rect($cx - $r, $cy - $r, 2 * $r, 2 * $r, $fill, null, $r);
    }

    /**
     * Raster image (PNG/JPEG/WebP file) drawn at (x, y) with width w; the
     * height follows the aspect ratio. Transparent parts become $background.
     * Returns the drawn height, or 0 when the image cannot be read.
     */
    public function image(string $path, float $x, float $y, float $w, string $background = '#ffffff'): float
    {
        if (!function_exists('imagecreatefromstring') || !is_file($path)) {
            return 0;
        }
        $src = @imagecreatefromstring((string) file_get_contents($path));
        if (!$src) {
            return 0;
        }
        [$iw, $ih] = [imagesx($src), imagesy($src)];
        $canvas = imagecreatetruecolor($iw, $ih);
        [$r, $g, $b] = self::hex($background);
        imagefill($canvas, 0, 0, (int) imagecolorallocate($canvas, (int) round($r * 255), (int) round($g * 255), (int) round($b * 255)));
        imagecopy($canvas, $src, 0, 0, 0, 0, $iw, $ih);
        ob_start();
        imagejpeg($canvas, null, 90);
        $jpeg = (string) ob_get_clean();
        $this->images[] = ['data' => $jpeg, 'w' => $iw, 'h' => $ih];
        $h = $w * $ih / max(1, $iw);
        $this->op(sprintf('q %s 0 0 %s %s %s cm /Im%d Do Q', self::n($w), self::n($h), self::n($x), self::n(self::HEIGHT - $y - $h), count($this->images)));
        return $h;
    }

    /** Clickable area opening an https:// address. */
    public function link(float $x, float $y, float $w, float $h, string $url): void
    {
        if (preg_match('#^https?://[^\s()\\\\]+$#', $url) && $this->current >= 0) {
            $this->links[$this->current][] = [$x, self::HEIGHT - $y - $h, $x + $w, self::HEIGHT - $y, $url];
        }
    }

    /** The finished document. */
    public function output(?int $now = null): string
    {
        if (!$this->pages) {
            $this->addPage();
        }
        $objects = [];
        $add = function (string $body) use (&$objects): int {
            $objects[] = $body;
            return count($objects);
        };
        $catalog = $add(''); // filled in below
        $pagesId = $add('');
        $f1 = $add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        $f2 = $add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        $xobjects = [];
        foreach ($this->images as $i => $img) {
            $id = $add(sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n%s\nendstream",
                $img['w'], $img['h'], strlen($img['data']), $img['data']));
            $xobjects[] = sprintf('/Im%d %d 0 R', $i + 1, $id);
        }
        $resources = sprintf('<< /Font << /F1 %d 0 R /F2 %d 0 R >>%s >>', $f1, $f2, $xobjects ? ' /XObject << ' . implode(' ', $xobjects) . ' >>' : '');
        $kids = [];
        foreach ($this->pages as $i => $ops) {
            $stream = function_exists('gzcompress') ? (string) gzcompress($ops, 6) : $ops;
            $filter = function_exists('gzcompress') ? ' /Filter /FlateDecode' : '';
            $content = $add(sprintf("<< /Length %d%s >>\nstream\n%s\nendstream", strlen($stream), $filter, $stream));
            $annots = [];
            foreach ($this->links[$i] as [$x1, $y1, $x2, $y2, $url]) {
                $annots[] = $add(sprintf('<< /Type /Annot /Subtype /Link /Rect [%s %s %s %s] /Border [0 0 0] /A << /S /URI /URI (%s) >> >>',
                    self::n($x1), self::n($y1), self::n($x2), self::n($y2), self::escape($url)));
            }
            $kids[] = $add(sprintf('<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %s %s] /Resources %s /Contents %d 0 R%s >>', $pagesId,
                self::n(self::WIDTH), self::n(self::HEIGHT), $resources, $content,
                $annots ? ' /Annots [' . implode(' ', array_map(fn ($a) => "$a 0 R", $annots)) . ']' : ''));
        }
        $objects[$catalog - 1] = sprintf('<< /Type /Catalog /Pages %d 0 R /ViewerPreferences << /DisplayDocTitle true >> >>', $pagesId);
        $objects[$pagesId - 1] = sprintf('<< /Type /Pages /Kids [%s] /Count %d >>', implode(' ', array_map(fn ($k) => "$k 0 R", $kids)), count($kids));
        $info = $add(sprintf('<< /Title <%s> /Producer (Sensum Content Manager) /CreationDate (D:%s) >>',
            strtoupper(bin2hex("\xFE\xFF" . mb_convert_encoding($this->title, 'UTF-16BE', 'UTF-8'))), gmdate('YmdHis', $now ?? time()) . 'Z'));

        $out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [];
        foreach ($objects as $i => $body) {
            $offsets[] = strlen($out);
            $out .= ($i + 1) . " 0 obj\n" . $body . "\nendobj\n";
        }
        $xref = strlen($out);
        $out .= 'xref' . "\n0 " . (count($objects) + 1) . "\n0000000000 65535 f \n";
        foreach ($offsets as $o) {
            $out .= sprintf("%010d 00000 n \n", $o);
        }
        $out .= sprintf("trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n", count($objects) + 1, $catalog, $info, $xref);
        return $out;
    }

    // ------------------------------------------------------------------ helpers

    private function op(string $op): void
    {
        if (!$this->pages) {
            $this->addPage();
        }
        $this->pages[$this->current] .= $op . "\n";
    }

    private function paint(string $path, ?string $fill, ?string $stroke, float $lineWidth): void
    {
        $ops = '';
        if ($fill !== null) {
            $ops .= $this->rgb($fill) . ' rg ';
        }
        if ($stroke !== null) {
            $ops .= self::n($lineWidth) . ' w ' . $this->rgb($stroke) . ' RG ';
        }
        $this->op($ops . $path . ' ' . ($fill !== null && $stroke !== null ? 'B' : ($fill !== null ? 'f' : 'S')));
    }

    private function rgb(string $hex): string
    {
        return implode(' ', array_map(fn ($v) => self::n($v), self::hex($hex)));
    }

    /** @return array{0:float,1:float,2:float} */
    private static function hex(string $hex): array
    {
        $h = ltrim($hex, '#');
        if (!preg_match('/^[0-9a-f]{6}$/i', $h)) {
            return [0.0, 0.0, 0.0];
        }
        return [hexdec(substr($h, 0, 2)) / 255, hexdec(substr($h, 2, 2)) / 255, hexdec(substr($h, 4, 2)) / 255];
    }

    private static function n(float|int $v): string
    {
        $s = rtrim(rtrim(sprintf('%.3F', $v), '0'), '.');
        return $s === '-0' ? '0' : $s;
    }

    private static function escape(string $s): string
    {
        return strtr($s, ['\\' => '\\\\', '(' => '\\(', ')' => '\\)', "\r" => '\\r']);
    }
}
