<?php
declare(strict_types=1);

namespace Sensum\Cms\Http;

/**
 * An expected, user-facing failure. `code` is a stable machine-readable
 * identifier that the admin UI translates into friendly ES/EN text;
 * no internal detail is ever sent to the client.
 */
final class ApiError extends \RuntimeException
{
    /**
     * @param array<string,string> $fields field => error code
     * @param array<string,mixed>  $extra  additional safe payload
     */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        public readonly array $fields = [],
        public readonly array $extra = [],
    ) {
        parent::__construct($errorCode, $status);
    }

    public static function validation(array $fields): self
    {
        return new self(422, 'validation', $fields);
    }
}
