<?php
/**
 * Sensum Content Manager — bootstrap.
 *
 * This folder (cms/) is private application code. In production it lives
 * OUTSIDE public_html (e.g. /home/<user>/sensum-cms); see
 * docs/NAMECHEAP_DEPLOYMENT.md. If it is ever uploaded inside public_html by
 * mistake, cms/.htaccess and the root .htaccess deny all web access to it.
 */
declare(strict_types=1);

if (PHP_VERSION_ID < 80100) {
    throw new RuntimeException('The Content Manager requires PHP 8.1 or newer.');
}
if (!is_file(__DIR__ . '/vendor/autoload.php')) {
    throw new RuntimeException('Dependencies are missing: run "composer install --no-dev" in the cms folder.');
}
require __DIR__ . '/vendor/autoload.php';

return Sensum\Cms\App::boot(__DIR__);
