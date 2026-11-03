import { router } from 'expo-router';
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

declare const process: { env: { EXPO_PUBLIC_API_URL?: string } };

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://192.168.1.23:4000';

type User = {
  id: number;
  fullName: string;
  email: string;
  role: string;
};

type LoginResponse = {
  success?: boolean;
  message?: string;
  token?: string;
  user?: User;
};

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/login`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: normalizedEmail,
            password,
          }),
        }
      );

      const result: LoginResponse = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || 'Unable to sign in. Please try again.'
        );
      }

      if (!result.token || !result.user) {
        throw new Error('The server returned an incomplete login response.');
      }

      // The mobile app is intended for Team Members and Associates.
      if (
        !['team_member', 'associate'].includes(result.user.role)
      ) {
        throw new Error(
          'This account is not enabled for the Heaven Gate mobile app.'
        );
      }

      // Save the JWT securely on the device.
      await SecureStore.setItemAsync(
        'heaven_gate_token',
        result.token
      );

      await SecureStore.setItemAsync(
        'heaven_gate_user',
        JSON.stringify(result.user)
      );

      // Open the app's home screen.
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof TypeError) {
        setError(
          'Cannot connect to Heaven Gate. Check that the backend is running and the API address is correct.'
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.'
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backText}>‹  Back</Text>
        </Pressable>

        <View style={styles.brand}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>HG</Text>
          </View>
          <Text style={styles.brandName}>HEAVEN GATE</Text>
          <Text style={styles.tagline}>
            A helping hand when it matters most.
          </Text>
        </View>

        <View style={styles.heading}>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>
            Sign in to manage your leads and services.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Email address</Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#94A3B8"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            editable={!loading}
            returnKeyType="next"
            style={styles.input}
          />

          <Text style={[styles.label, styles.passwordLabel]}>
            Password
          </Text>

          <View style={styles.passwordContainer}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor="#94A3B8"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              editable={!loading}
              returnKeyType="go"
              onSubmitEditing={handleLogin}
              style={styles.passwordInput}
            />

            <Pressable
              onPress={() => setShowPassword(!showPassword)}
              hitSlop={10}
            >
              <Text style={styles.showPassword}>
                {showPassword ? 'Hide' : 'Show'}
              </Text>
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={handleLogin}
            disabled={loading}
            style={({ pressed }) => [
              styles.loginButton,
              pressed && !loading && styles.buttonPressed,
              loading && styles.buttonDisabled,
            ]}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.loginButtonText}>
                Sign in securely
              </Text>
            )}
          </Pressable>

          <View style={styles.registerRow}>
            <Text style={styles.registerText}>
              New to Heaven Gate?
            </Text>
            <Pressable
              disabled={loading}
              onPress={() => router.push('/auth')}
            >
              <Text style={styles.registerLink}> Create account</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.footer}>
          Your work. Your community. One place.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4F7F8',
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 30,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingRight: 12,
  },
  backText: {
    color: '#357A72',
    fontSize: 16,
    fontWeight: '600',
  },
  brand: {
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 34,
  },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: '#174D48',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 1,
  },
  brandName: {
    color: '#174D48',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: 2.5,
  },
  tagline: {
    color: '#718096',
    fontSize: 12,
    marginTop: 7,
  },
  heading: {
    marginBottom: 22,
  },
  title: {
    color: '#172F3D',
    fontSize: 29,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  subtitle: {
    color: '#718096',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 21,
    borderWidth: 1,
    borderColor: '#E4EBEC',
  },
  label: {
    color: '#273E4B',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 9,
  },
  input: {
    height: 51,
    borderWidth: 1,
    borderColor: '#DCE5E7',
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#172F3D',
    fontSize: 14,
    backgroundColor: '#FCFDFD',
  },
  passwordLabel: {
    marginTop: 20,
  },
  passwordContainer: {
    height: 51,
    borderWidth: 1,
    borderColor: '#DCE5E7',
    borderRadius: 12,
    paddingLeft: 14,
    paddingRight: 13,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FCFDFD',
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    color: '#172F3D',
    fontSize: 14,
  },
  showPassword: {
    color: '#357A72',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 10,
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    marginTop: 16,
  },
  errorText: {
    color: '#B42318',
    fontSize: 12,
    lineHeight: 18,
  },
  loginButton: {
    height: 52,
    borderRadius: 13,
    backgroundColor: '#174D48',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 21,
  },
  registerText: {
    color: '#718096',
    fontSize: 12,
  },
  registerLink: {
    color: '#26776D',
    fontSize: 12,
    fontWeight: '800',
  },
  footer: {
    textAlign: 'center',
    color: '#84939B',
    fontSize: 11,
    marginTop: 25,
  },
});