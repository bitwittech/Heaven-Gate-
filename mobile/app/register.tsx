
import { useLocalSearchParams, router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const NAVY = '#17324D';
const TEAL = '#174D48';
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:4000';

type OtpKind = 'email' | 'phone';

type ApiResult = {
  success?: boolean;
  message?: string;
  verified?: boolean;
  token?: string;
  user?: {
    id: number;
    fullName: string;
    email: string;
    role: string;
  };
};

async function readResult(response: Response): Promise<ApiResult> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export default function RegisterScreen() {
  const params = useLocalSearchParams<{ role?: string }>();
  const role = params.role === 'team' ? 'team_member' : 'associate';
  const isTeamMember = role === 'team_member';

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');

  const [emailOtp, setEmailOtp] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [phoneSent, setPhoneSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);

  const [busy, setBusy] = useState<OtpKind | 'register' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = phone.replace(/\D/g, '');
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const validPhone =
    normalizedPhone.length >= 10 && normalizedPhone.length <= 15;

  const canVerifyContacts =
    name.trim().length >= 2 && validEmail && validPhone;

  async function requestOtp(kind: OtpKind) {
    if (!canVerifyContacts) {
      setError('Enter your name, a valid phone number, and a valid email first.');
      return;
    }

    setError('');
    setMessage('');
    setBusy(kind);

    const value =
      kind === 'email' ? normalizedEmail : normalizedPhone;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/otp/${kind}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(
            kind === 'email' ? { email: value } : { phone: value }
          ),
        }
      );

      const result = await readResult(response);

      if (!response.ok || result.success === false) {
        throw new Error(result.message || `Could not send ${kind} OTP.`);
      }

      if (kind === 'email') {
        setEmailSent(true);
        setEmailVerified(false);
        setEmailOtp('');
      } else {
        setPhoneSent(true);
        setPhoneVerified(false);
        setPhoneOtp('');
      }

      setMessage(`Verification code sent to your ${kind}.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not send the verification code.'
      );
    } finally {
      setBusy(null);
    }
  }

  async function verifyOtp(kind: OtpKind) {
    const otp = kind === 'email' ? emailOtp.trim() : phoneOtp.trim();

    if (!/^\d{6}$/.test(otp)) {
      setError(`Enter the six-digit ${kind} OTP.`);
      return;
    }

    setError('');
    setMessage('');
    setBusy(kind);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/otp/${kind}/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(
            kind === 'email'
              ? { email: normalizedEmail, otp }
              : { phone: normalizedPhone, otp }
          ),
        }
      );

      const result = await readResult(response);

      if (!response.ok || result.success === false || result.verified === false) {
        throw new Error(result.message || `The ${kind} OTP is invalid or expired.`);
      }

      if (kind === 'email') {
        setEmailVerified(true);
      } else {
        setPhoneVerified(true);
      }

      setMessage(`${kind === 'email' ? 'Email' : 'Phone number'} verified successfully.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Verification failed. Please try again.'
      );
    } finally {
      setBusy(null);
    }
  }

  async function createAccount() {
    if (!name.trim()  || !validEmail || !password || !confirmPassword) {
      setError('Complete all required fields with valid contact details.');
      return;
    }

    if (password.length < 8) {
      setError('Your password must contain at least eight characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Your passwords do not match.');
      return;
    }

    if (!emailVerified) {
      setError('Verify your email before continuing.');
      return;
    }

    if (isTeamMember && !code.trim()) {
      setError('Enter the authorization code provided by the owner.');
      return;
    }

    setError('');
    setMessage('');
    setBusy('register');

    try {
      const endpoint = isTeamMember
        ? '/api/admin/register/team-member'
        : '/api/auth/register/associate';

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          fullName: name.trim(),
          phone: normalizedPhone,
          email: normalizedEmail,
          password,
          ...(isTeamMember ? { code: code.trim() } : {}),
        }),
      });

      const result = await readResult(response);

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Account creation failed.');
      }

      // The registration endpoint must return a session token to sign in
      // automatically. Do not fabricate a session on the device.
      if (!result.token || !result.user) {
        setMessage('Account response received. Please sign in to continue.');
        router.replace('/login');
        return;
      }

      if (!['team_member', 'associate'].includes(result.user.role)) {
        throw new Error('The server returned an unsupported account role.');
      }

      await SecureStore.setItemAsync('heaven_gate_token', result.token);
      await SecureStore.setItemAsync(
        'heaven_gate_user',
        JSON.stringify(result.user)
      );
      await SecureStore.setItemAsync('heaven_gate_intro_complete', 'true');

      router.replace('/dashboard');
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Cannot connect to Heaven Gate. Check that the backend is running and the API URL is correct.'
          : err instanceof Error
            ? err.message
            : 'Could not create your account.'
      );
    } finally {
      setBusy(null);
    }
  }

  function updateEmail(value: string) {
    setEmail(value);
    setEmailSent(false);
    setEmailVerified(false);
    setEmailOtp('');
    setError('');
    setMessage('');
  }

  function updatePhone(value: string) {
    setPhone(value);
    setPhoneSent(false);
    setPhoneVerified(false);
    setPhoneOtp('');
    setError('');
    setMessage('');
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.back}>‹  Back</Text>
        </Pressable>

        <View style={styles.brandRow}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>HG</Text>
          </View>
          <View>
            <Text style={styles.brandName}>HEAVEN GATE</Text>
            <Text style={styles.brandCaption}>SERVICE PARTNER NETWORK</Text>
          </View>
        </View>

        <View style={styles.heading}>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>
              {isTeamMember ? 'TEAM MEMBER' : 'ASSOCIATE'}
            </Text>
          </View>
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>
            Add your details, then verify your email to continue.
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.sectionTitle}>Personal details</Text>

          <Field
            label="Full name *"
            value={name}
            onChangeText={setName}
            placeholder="Enter your full name"
            autoCapitalize="words"
            editable={busy === null}
          />

          <Field
            label="Phone number *"
            value={phone}
            onChangeText={updatePhone}
            placeholder="10-digit mobile number"
            keyboardType="phone-pad"
            editable={busy === null && !phoneVerified}
          />

          <Field
            label="Email address *"
            value={email}
            onChangeText={updateEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            editable={busy === null && !emailVerified}
          />

          {isTeamMember && (
            <Field
              label="Owner authorization code *"
              value={code}
              onChangeText={setCode}
              placeholder="Enter your invitation code"
              autoCapitalize="characters"
              editable={busy === null}
            />
          )}

          <Text style={styles.helper}>
            {isTeamMember
              ? 'Your authorization code must be valid and unused. Your Team Member role will be assigned by the server.'
              : 'Associates register independently and cannot create teams or add members.'}
          </Text>

          {canVerifyContacts && (
            <View style={styles.verificationSection}>
              <Text style={styles.sectionTitle}>Verify your contact details</Text>
              <Text style={styles.verificationIntro}>
                Email verification is required before account creation.
              </Text>

              <VerificationCard
                title="Email verification"
                value={normalizedEmail}
                sent={emailSent}
                verified={emailVerified}
                otp={emailOtp}
                setOtp={setEmailOtp}
                onSend={() => requestOtp('email')}
                onVerify={() => verifyOtp('email')}
                busy={busy === 'email'}
                disabled={busy !== null || emailVerified}
              />

              {/* <VerificationCard
                title="Phone verification"
                value={normalizedPhone}
                sent={phoneSent}
                verified={phoneVerified}
                otp={phoneOtp}
                setOtp={setPhoneOtp}
                onSend={() => requestOtp('phone')}
                onVerify={() => verifyOtp('phone')}
                busy={busy === 'phone'}
                disabled={busy !== null || phoneVerified}
              /> */}
            </View>
          )}

          <View style={styles.securityNote}>
            <Text style={styles.securityTitle}>Secure account setup</Text>
            <Text style={styles.securityText}>
              Your account will only be created after the server validates both OTPs
              and, for Team Members, the authorization code.
            </Text>
          </View>

          <Text style={[styles.sectionTitle, styles.passwordHeading]}>
            Set your password
          </Text>

          <Field
            label="Password *"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secureTextEntry
            autoCapitalize="none"
            editable={busy === null}
          />

          <Field
            label="Confirm password *"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Enter your password again"
            secureTextEntry
            autoCapitalize="none"
            editable={busy === null}
          />

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {message ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>{message}</Text>
            </View>
          ) : null}

          <Pressable
            disabled={busy !== null}
            onPress={createAccount}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.pressed,
              busy !== null && styles.disabledButton,
            ]}
          >
            {busy === 'register' ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Create account</Text>
            )}
          </Pressable>

          <View style={styles.signInRow}>
            <Text style={styles.signInText}>Already registered?</Text>
            <Pressable onPress={() => router.replace('/login')}>
              <Text style={styles.signInLink}> Sign in</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.footer}>
          Heaven Gate · Service with compassion and dignity
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function VerificationCard({
  title,
  value,
  sent,
  verified,
  otp,
  setOtp,
  onSend,
  onVerify,
  busy,
  disabled,
}: {
  title: string;
  value: string;
  sent: boolean;
  verified: boolean;
  otp: string;
  setOtp: (value: string) => void;
  onSend: () => void;
  onVerify: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <View style={styles.verificationCard}>
      <View style={styles.verificationHeader}>
        <View style={styles.flex}>
          <Text style={styles.verificationTitle}>{title}</Text>
          <Text style={styles.contactValue} numberOfLines={1}>{value}</Text>
        </View>
        <View style={[styles.statusBadge, verified && styles.verifiedBadge]}>
          <Text style={[styles.statusText, verified && styles.verifiedText]}>
            {verified ? 'Verified' : sent ? 'OTP sent' : 'Required'}
          </Text>
        </View>
      </View>

      {verified ? (
        <Text style={styles.verifiedMessage}>✓ Contact verified successfully</Text>
      ) : (
        <>
          {sent && (
            <TextInput
              value={otp}
              onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Enter 6-digit OTP"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              maxLength={6}
              style={styles.input}
              editable={!busy}
            />
          )}

          <View style={styles.otpActions}>
            <Pressable
              onPress={onSend}
              disabled={disabled || busy}
              style={[styles.outlineButton, (disabled || busy) && styles.disabledButton]}
            >
              {busy ? (
                <ActivityIndicator color={TEAL} size="small" />
              ) : (
                <Text style={styles.outlineButtonText}>
                  {sent ? 'Resend OTP' : 'Send OTP'}
                </Text>
              )}
            </Pressable>

            {sent && (
              <Pressable
                onPress={onVerify}
                disabled={disabled || busy || otp.length !== 6}
                style={[
                  styles.verifyButton,
                  (disabled || busy || otp.length !== 6) && styles.disabledButton,
                ]}
              >
                <Text style={styles.verifyButtonText}>Verify</Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  secureTextEntry = false,
  autoCapitalize = 'sentences',
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9AA6B2"
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        editable={editable}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F7F6' },
  page: { flexGrow: 1, padding: 24, paddingTop: 20, paddingBottom: 32 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 20 },
  back: { color: TEAL, fontSize: 15, fontWeight: '700' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: {
    width: 45, height: 45, borderRadius: 15, backgroundColor: TEAL,
    alignItems: 'center', justifyContent: 'center',
  },
  logoText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  brandName: { color: NAVY, fontSize: 14, fontWeight: '900', letterSpacing: 1.8 },
  brandCaption: { color: '#718096', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 4 },
  heading: { marginTop: 29, marginBottom: 20 },
  roleBadge: {
    alignSelf: 'flex-start', backgroundColor: '#E0ECE7',
    paddingHorizontal: 11, paddingVertical: 7, borderRadius: 20, marginBottom: 13,
  },
  roleBadgeText: { color: TEAL, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { color: NAVY, fontSize: 28, lineHeight: 35, fontWeight: '800' },
  subtitle: { color: '#64748B', fontSize: 13, lineHeight: 20, marginTop: 8 },
  form: {
    backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1,
    borderColor: '#E3EBE7', padding: 18,
  },
  sectionTitle: { color: NAVY, fontSize: 15, fontWeight: '800', marginBottom: 14 },
  field: { marginBottom: 15 },
  label: { color: NAVY, fontSize: 12, fontWeight: '700', marginBottom: 7 },
  input: {
    minHeight: 49, borderWidth: 1, borderColor: '#DCE5E1',
    borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12,
    color: NAVY, fontSize: 14, backgroundColor: '#FCFDFD',
  },
  helper: { color: '#718096', fontSize: 11, lineHeight: 17, marginTop: -2, marginBottom: 18 },
  verificationSection: {
    borderTopWidth: 1, borderTopColor: '#E8EEEA',
    paddingTop: 20, marginTop: 3, marginBottom: 18,
  },
  verificationIntro: { color: '#718096', fontSize: 12, lineHeight: 18, marginTop: -7, marginBottom: 13 },
  verificationCard: {
    borderRadius: 15, borderWidth: 1, borderColor: '#DDE8E2',
    backgroundColor: '#FAFCFB', padding: 13, marginBottom: 12,
  },
  verificationHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  flex: { flex: 1 },
  verificationTitle: { color: NAVY, fontSize: 13, fontWeight: '800' },
  contactValue: { color: '#718096', fontSize: 11, marginTop: 4 },
  statusBadge: { borderRadius: 12, backgroundColor: '#F1F5F9', paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { color: '#64748B', fontSize: 10, fontWeight: '800' },
  verifiedBadge: { backgroundColor: '#DDF4E6' },
  verifiedText: { color: '#197044' },
  verifiedMessage: { color: '#197044', fontSize: 12, fontWeight: '700' },
  otpActions: { flexDirection: 'row', gap: 9, marginTop: 10 },
  outlineButton: {
    flex: 1, minHeight: 42, borderRadius: 11, borderWidth: 1,
    borderColor: TEAL, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
  },
  outlineButtonText: { color: TEAL, fontSize: 12, fontWeight: '800' },
  verifyButton: {
    flex: 1, minHeight: 42, borderRadius: 11,
    backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center',
  },
  verifyButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  securityNote: {
    backgroundColor: '#F0F6F3', borderRadius: 13,
    padding: 13, marginBottom: 20,
  },
  securityTitle: { color: NAVY, fontSize: 12, fontWeight: '800' },
  securityText: { color: '#64748B', fontSize: 11, lineHeight: 17, marginTop: 5 },
  passwordHeading: { marginBottom: 14 },
  errorBox: { backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 10, padding: 11, marginTop: 4, marginBottom: 12 },
  errorText: { color: '#B42318', fontSize: 12, lineHeight: 18 },
  successBox: { backgroundColor: '#EAF7EF', borderRadius: 10, padding: 11, marginTop: 4, marginBottom: 12 },
  successText: { color: '#197044', fontSize: 12, lineHeight: 18 },
  button: {
    minHeight: 52, backgroundColor: TEAL, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center', padding: 14, marginTop: 5,
  },
  buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  pressed: { opacity: 0.8 },
  disabledButton: { opacity: 0.55 },
  signInRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', marginTop: 19 },
  signInText: { color: '#718096', fontSize: 12 },
  signInLink: { color: TEAL, fontSize: 12, fontWeight: '900' },
  footer: { textAlign: 'center', color: '#87958F', fontSize: 10, marginTop: 19 },
});
