
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const NAVY = '#17324D';
const TEAL = '#174D48';

export default function AuthScreen() {
    return (
        <SafeAreaView style={styles.screen}>
            <Pressable onPress={() => router.back()} style={styles.back}>
                <Text style={styles.backText}>← Back</Text>
            </Pressable>

            <View style={styles.logo}>
                <Text style={styles.logoText}>HG</Text>
            </View>

            <Text style={styles.brand}>HEAVEN GATE</Text>
            <Text style={styles.title}>Welcome aboard.</Text>
            <Text style={styles.subtitle}>
                Sign in to your account or choose how you want to join our service network.
            </Text>

            <Pressable
                onPress={() => router.push('/login')}
                style={styles.primaryButton}
            >
                <Text style={styles.primaryText}>Sign In</Text>
            </Pressable>

            <Text style={styles.sectionLabel}>CREATE AN ACCOUNT</Text>

            <Pressable
                onPress={() => router.push('/register?role=associate')}
                style={styles.option}
            >
                <View style={styles.optionText}>
                    <Text style={styles.optionTitle}>Join as Associate</Text>
                    <Text style={styles.optionDescription}>
                        Register independently and manage your permitted enquiries.
                    </Text>
                </View>
                <Text style={styles.arrow}>→</Text>
            </Pressable>

            <Pressable
                onPress={() => router.push('/register?role=team')}
                style={styles.option}
            >
                <View style={styles.optionText}>
                    <Text style={styles.optionTitle}>Join as Team Member</Text>
                    <Text style={styles.optionDescription}>
                        Join an authorised team using an invitation code.
                    </Text>
                </View>
                <Text style={styles.arrow}>→</Text>
            </Pressable>

            <Text style={styles.footer}>
                Service with compassion, dignity, and clarity.
            </Text>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#F5F7F6', padding: 25 },
    back: { alignSelf: 'flex-start', marginTop: 8, marginBottom: 28 },
    backText: { color: TEAL, fontSize: 14, fontWeight: '700' },
    logo: {
        width: 56, height: 56, borderRadius: 18, backgroundColor: TEAL,
        alignItems: 'center', justifyContent: 'center',
    },
    logoText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
    brand: {
        color: NAVY, fontSize: 12, fontWeight: '800',
        letterSpacing: 2, marginTop: 15,
    },
    title: { color: NAVY, fontSize: 31, fontWeight: '800', marginTop: 30 },
    subtitle: { color: '#718096', fontSize: 14, lineHeight: 22, marginTop: 10, marginBottom: 28 },
    primaryButton: {
        height: 54, borderRadius: 15, backgroundColor: TEAL,
        alignItems: 'center', justifyContent: 'center',
    },
    primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
    sectionLabel: {
        color: '#718096', fontSize: 10, fontWeight: '800',
        letterSpacing: 1.4, marginTop: 30, marginBottom: 13,
    },
    option: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E9E5',
        borderRadius: 16, padding: 17, marginBottom: 12,
    },
    optionText: { flex: 1 },
    optionTitle: { color: NAVY, fontSize: 14, fontWeight: '800' },
    optionDescription: { color: '#718096', fontSize: 12, lineHeight: 18, marginTop: 5 },
    arrow: { color: TEAL, fontSize: 22 },
    footer: {
        color: '#87958F', fontSize: 11, textAlign: 'center',
        marginTop: 'auto', paddingTop: 24, paddingBottom: 12,
    },
});
