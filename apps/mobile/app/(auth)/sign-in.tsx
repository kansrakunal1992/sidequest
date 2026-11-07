import { useEffect, useState } from 'react';
import { AppText, Button, ErrorText, Screen, Spacer, TextField } from '@/design/ui';
import { LegalLinks } from '@/features/LegalLinks';
import { supabase } from '@/lib/supabase';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Passwordless: we email a one-time code. No password to leak or forget. */
export default function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  async function sendCode() {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) { setError('Enter a valid email address.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ email: e, options: { shouldCreateUser: true } });
    setBusy(false);
    if (err) { setError('We could not send a code. Check the address and try again.'); return; }
    setSent(true); setCooldown(30);
  }
  async function verify() {
    const t = code.replace(/\s/g, '');
    if (!/^\d{6,8}$/.test(t)) { setError('Enter the code from your email.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: t, type: 'email' });
    setBusy(false);
    if (err) setError('That code did not work. It may have expired, so request a new one.');
    // On success the session listener updates the app and the Gate moves you on.
  }

  return (
    <Screen>
      <Spacer h={32} />
      <AppText variant="headline" accessibilityRole="header">{sent ? 'Check your email' : 'Sign in or join'}</AppText>
      <Spacer h={8} />
      <AppText muted>{sent ? `We sent a code to ${email.trim()}.` : 'We will email you a one-time code. No password needed.'}</AppText>
      <Spacer h={24} />
      {!sent ? (
        <>
          <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" placeholder="you@example.com" />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Spacer /><Button label="Send code" onPress={sendCode} loading={busy} />
        </>
      ) : (
        <>
          <TextField label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={8} placeholder="123456" />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Spacer /><Button label="Continue" onPress={verify} loading={busy} />
          <Spacer h={8} /><Button kind="ghost" label={cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'} disabled={cooldown > 0} onPress={sendCode} />
          <Button kind="ghost" label="Use a different email" onPress={() => { setSent(false); setCode(''); setError(null); }} />
        </>
      )}
      <Spacer h={24} />
      <LegalLinks lead="By continuing you confirm you are 18 or over and agree to our Terms and Community Guidelines and Privacy Policy." />
    </Screen>
  );
}
