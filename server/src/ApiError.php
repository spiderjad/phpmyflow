<?php
declare(strict_types=1);

namespace PhpMyFlow;

/**
 * Error sent to the client. `code` is a stable machine key that the
 * frontend translates; `message` is an English fallback.
 */
final class ApiError extends \RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status = 400,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }
}
