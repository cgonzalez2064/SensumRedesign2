<?php
// Generates test images for upload tests (run: php tests/fixtures/make-fixtures.php).
// Output goes to tests/fixtures/out/ (git-ignored).
$out = __DIR__ . '/out';
@mkdir($out, 0755, true);

function photo(int $w, int $h, string $label, array $c1, array $c2) {
    $im = imagecreatetruecolor($w, $h);
    for ($y = 0; $y < $h; $y += 4) {
        $t = $y / max(1, $h - 1);
        $col = imagecolorallocate($im, (int) ($c1[0] + ($c2[0] - $c1[0]) * $t), (int) ($c1[1] + ($c2[1] - $c1[1]) * $t), (int) ($c1[2] + ($c2[2] - $c1[2]) * $t));
        imagefilledrectangle($im, 0, $y, $w, $y + 3, $col);
    }
    $white = imagecolorallocate($im, 255, 255, 255);
    // A centered "subject" and corner markers make crops easy to verify visually.
    imagefilledellipse($im, intdiv($w, 2), intdiv($h, 2), intdiv(min($w, $h), 3), intdiv(min($w, $h), 3), $white);
    $mark = imagecolorallocate($im, 246, 116, 10);
    foreach ([[0, 0], [$w - 60, 0], [0, $h - 60], [$w - 60, $h - 60]] as [$x, $y]) {
        imagefilledrectangle($im, $x, $y, $x + 59, $y + 59, $mark);
    }
    imagestring($im, 5, 20, 80, $label . " {$w}x{$h}", $white);
    return $im;
}

imagejpeg(photo(4000, 3000, 'landscape-4x3', [40, 60, 90], [120, 80, 40]), "$out/landscape-4000x3000.jpg", 85);
imagejpeg(photo(1600, 900, 'wide-16x9', [20, 90, 70], [200, 160, 60]), "$out/wide-1600x900.jpg", 85);
imagejpeg(photo(1200, 1600, 'portrait', [90, 40, 60], [30, 30, 30]), "$out/portrait-1200x1600.jpg", 85);
imagepng(photo(1800, 1800, 'square-png', [60, 60, 60], [10, 120, 160]), "$out/square-1800.png");
if (function_exists('imagewebp')) {
    imagewebp(photo(1600, 1200, 'webp', [100, 100, 30], [30, 30, 100]), "$out/photo-1600x1200.webp", 85);
}
imagejpeg(photo(800, 600, 'too-small', [80, 80, 80], [20, 20, 20]), "$out/small-800x600.jpg", 85);
imagejpeg(photo(9000, 6000, 'huge', [80, 50, 50], [20, 60, 20]), "$out/huge-9000x6000.jpg", 70);

// Not an image: PHP code with a .jpg name, and a polyglot (valid JPEG + appended PHP).
file_put_contents("$out/script-disguised.jpg", "<?php echo 'pwned'; ?>\n");
copy("$out/wide-1600x900.jpg", "$out/polyglot.jpg");
file_put_contents("$out/polyglot.jpg", "\n<?php system(\$_GET['c']); ?>", FILE_APPEND);
// Truncated (corrupted) JPEG.
file_put_contents("$out/corrupt.jpg", substr((string) file_get_contents("$out/wide-1600x900.jpg"), 0, 4000));
// Extension/type mismatch: PNG data named .jpg.
copy("$out/square-1800.png", "$out/png-named.jpg");
// SVG (not allowed) and an HTML file.
file_put_contents("$out/vector.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
file_put_contents("$out/page.html", '<html><script>alert(1)</script></html>');
// Minimal valid PDF and a fake PDF.
file_put_contents("$out/portfolio.pdf", "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
file_put_contents("$out/fake.pdf", "not a pdf at all");
echo "Fixtures written to $out\n";
foreach (glob("$out/*") as $f) {
    printf("  %-28s %8d bytes\n", basename($f), filesize($f));
}
