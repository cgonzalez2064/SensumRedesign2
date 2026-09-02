<?php
/**
 * EXAMPLE ONLY — copy this file to a location ONE LEVEL ABOVE
 * public_html on the live server (i.e. NOT inside the folder your
 * domain serves, and NOT inside this git/deployment repo) and rename
 * it to sensum-mail-config.php, then fill in real values. It is
 * loaded by assets/contact-handler.php if present.
 *
 * NEVER commit a filled-in copy of this file to source control, and
 * never place it inside public_html — cPanel's file structure
 * typically looks like:
 *
 *   /home/<cpanel-user>/
 *     sensum-mail-config.php   <-- real file goes HERE (outside web root)
 *     public_html/
 *       index.html
 *       assets/
 *         contact-handler.php
 *
 * If this file does not exist on the server, contact-handler.php
 * automatically falls back to PHP's built-in mail() — which works
 * without any of this, just with weaker deliverability guarantees.
 *
 * DNS PREREQUISITES for either path (mail() or SMTP) to land in the
 * inbox instead of spam — set these up in the domain's DNS zone:
 *   - SPF:   TXT record on the root domain authorizing your sending
 *            host/SMTP provider, e.g.
 *            "v=spf1 include:<your-smtp-provider> ~all"
 *   - DKIM:  a DKIM key pair from your SMTP provider (or cPanel's
 *            Email Deliverability tool for mail()), published as a
 *            TXT record at <selector>._domainkey.sensumconstrucciones.com
 *   - DMARC: TXT record at _dmarc.sensumconstrucciones.com, e.g.
 *            "v=DMARC1; p=quarantine; rua=mailto:contacto@sensumconstrucciones.com"
 *   cPanel → Email Deliverability shows whether these currently
 *   validate for this domain and can auto-install the DNS records it
 *   suggests.
 *
 * This example wires up SMTP via PHP's built-in stream sockets so no
 * third-party library is required. If you'd rather use a library
 * (e.g. PHPMailer), replace the body of $smtpSend with that call —
 * just keep the same function signature so contact-handler.php can
 * call it unchanged.
 */

$smtpSend = function (string $to, string $subject, string $body, string $fromEmail, string $fromName, string $replyToEmail, string $replyToName): bool {
    $host = 'smtp.example.com';       // <-- fill in
    $port = 587;                      // 587 = STARTTLS, 465 = implicit TLS
    $username = 'no-reply@sensumconstrucciones.com'; // <-- fill in
    $password = 'CHANGE_ME';          // <-- fill in — never commit a real value

    // Minimal STARTTLS SMTP client. For anything more than occasional
    // lead-form volume, prefer a maintained library instead.
    $errno = 0; $errstr = '';
    $smtp = @stream_socket_client("tcp://$host:$port", $errno, $errstr, 10);
    if (!$smtp) {
        error_log('[sensum-contact] smtp_connect_failed: ' . $errstr);
        return false;
    }
    $read = function () use ($smtp) { return fgets($smtp, 515); };
    $write = function ($cmd) use ($smtp) { fwrite($smtp, $cmd . "\r\n"); };

    $read();
    $fromDomain = substr(strrchr($fromEmail, '@'), 1) ?: 'localhost';
    $write('EHLO ' . $fromDomain); $read();
    $write('STARTTLS'); $read();
    stream_socket_enable_crypto($smtp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
    $write('EHLO localhost'); $read();
    $write('AUTH LOGIN'); $read();
    $write(base64_encode($username)); $read();
    $write(base64_encode($password)); $read();
    $write("MAIL FROM:<$fromEmail>"); $read();
    $write("RCPT TO:<$to>"); $read();
    $write('DATA'); $read();

    $headers = "From: $fromName <$fromEmail>\r\n"
        . "Reply-To: $replyToName <$replyToEmail>\r\n"
        . "Subject: $subject\r\n"
        . "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n";
    $write($headers . "\r\n" . $body . "\r\n.");
    $response = $read();
    $write('QUIT');
    fclose($smtp);

    return strpos((string) $response, '250') === 0;
};
