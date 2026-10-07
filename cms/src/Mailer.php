<?php
declare(strict_types=1);

namespace Sensum\Cms;

use PHPMailer\PHPMailer\PHPMailer;

/**
 * Outgoing e-mail through PHPMailer (SMTP), configured only from
 * environment values. Delivery problems never throw to callers: they are
 * logged without credentials or server responses, and `send()` returns false.
 *
 * MAIL_DRIVER:
 *   smtp      real delivery (production; Mailpit locally)
 *   log       write each message to storage/mail/*.eml instead of sending
 *   disabled  never send (send() returns false — useful to test failures)
 */
final class Mailer
{
    public function __construct(private Config $config, private Logger $logger, private string $outbox)
    {
    }

    public function driver(): string
    {
        $d = strtolower($this->config->string('MAIL_DRIVER', 'smtp'));
        return in_array($d, ['smtp', 'log', 'disabled'], true) ? $d : 'smtp';
    }

    /** True when the configuration looks complete enough to attempt delivery. */
    public function isConfigured(): bool
    {
        return match ($this->driver()) {
            'log' => true,
            'disabled' => false,
            default => $this->config->string('SMTP_HOST') !== '' && filter_var($this->fromAddress(), FILTER_VALIDATE_EMAIL) !== false,
        };
    }

    private function fromAddress(): string
    {
        return $this->config->string('SMTP_FROM_ADDRESS', 'no-reply@sensumconstrucciones.com');
    }

    /**
     * @param array{to:string, subject:string, text:string, html?:string, replyTo?:array{0:string,1:string}, attachments?:list<array{path:string,name:string,mime:string}>} $m
     */
    public function send(array $m): bool
    {
        if (!filter_var($m['to'], FILTER_VALIDATE_EMAIL)) {
            $this->logger->error('mail_invalid_recipient');
            return false;
        }
        $driver = $this->driver();
        if ($driver === 'disabled') {
            $this->logger->warning('mail_disabled', ['subject' => mb_substr($m['subject'], 0, 80)]);
            return false;
        }

        $mail = new PHPMailer(true);
        try {
            $mail->CharSet = PHPMailer::CHARSET_UTF8;
            $mail->Encoding = PHPMailer::ENCODING_QUOTED_PRINTABLE;
            $mail->XMailer = ' ';
            // PHPMailer validates addresses and encodes headers, which closes
            // e-mail header injection; subjects are also stripped of CR/LF below.
            $mail->setFrom($this->fromAddress(), self::oneLine($this->config->string('SMTP_FROM_NAME', 'Sensum Construcciones')), false);
            $mail->addAddress($m['to']);
            if (!empty($m['replyTo']) && filter_var($m['replyTo'][0], FILTER_VALIDATE_EMAIL)) {
                $mail->addReplyTo($m['replyTo'][0], self::oneLine($m['replyTo'][1]));
            }
            $mail->Subject = self::oneLine($m['subject']);
            if (!empty($m['html'])) {
                $mail->isHTML(true);
                $mail->Body = $m['html'];
                $mail->AltBody = $m['text'];
            } else {
                $mail->Body = $m['text'];
            }
            foreach ($m['attachments'] ?? [] as $a) {
                $mail->addAttachment($a['path'], self::oneLine($a['name']), PHPMailer::ENCODING_BASE64, $a['mime']);
            }

            if ($driver === 'log') {
                $mail->preSend();
                $file = $this->outbox . '/' . date('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.eml';
                file_put_contents($file, $mail->getSentMIMEMessage());
                @chmod($file, 0600);
                $this->logger->info('mail_logged', ['file' => basename($file)]);
                return true;
            }

            $mail->isSMTP();
            $mail->Host = $this->config->string('SMTP_HOST');
            $mail->Port = $this->config->int('SMTP_PORT', 587, 1, 65535);
            $mail->Timeout = $this->config->int('SMTP_TIMEOUT', 15, 3, 60);
            $user = $this->config->string('SMTP_USERNAME');
            if ($user !== '') {
                $mail->SMTPAuth = true;
                $mail->Username = $user;
                $mail->Password = $this->config->string('SMTP_PASSWORD');
            }
            $enc = strtolower($this->config->string('SMTP_ENCRYPTION', 'tls'));
            if ($enc === 'ssl' || $enc === 'smtps') {
                $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
            } elseif ($enc === 'tls' || $enc === 'starttls') {
                $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            } else {
                $mail->SMTPSecure = '';
                $mail->SMTPAutoTLS = false;
            }
            $mail->SMTPDebug = 0;
            $mail->send();
            $this->logger->info('mail_sent', ['subject' => mb_substr($mail->Subject, 0, 80)]);
            return true;
        } catch (\Throwable $e) {
            // Deliberately do not log $e->getMessage(): SMTP transcripts can
            // contain server details. The class name is enough to triage.
            $this->logger->error('mail_failed', ['driver' => $driver, 'kind' => (new \ReflectionClass($e))->getShortName()]);
            return false;
        }
    }

    /** Removes CR/LF and other control characters (header-injection guard). */
    public static function oneLine(string $s, int $max = 200): string
    {
        $s = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $s) ?? '';
        return mb_substr(trim(preg_replace('/\s+/u', ' ', $s) ?? ''), 0, $max);
    }
}
