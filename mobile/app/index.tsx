
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const NAVY = '#17324D';
const TEAL = '#174D48';
const MUTED = '#718096';
const BG = '#F5F7F6';

export default function WelcomeScreen() {
  const { width, height } = useWindowDimensions();
  const pager = useRef<ScrollViewInstance | null>(null);
  const [page, setPage] = useState(0);
  const pageHeight = Math.max(height - 70, 620);

  function changePage(next: number) {
    pager.current?.scrollTo({ x: width * next, y: 0, animated: true });
    setPage(next);
  }

  function onSwipe(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  const [checkingStartup, setCheckingStartup] = useState(true);

  useEffect(() => {
    let active = true;

    async function checkStartup() {
      try {
        const introComplete = await SecureStore.getItemAsync(
          'heaven_gate_intro_complete'
        );
        const token = await SecureStore.getItemAsync(
          'heaven_gate_token'
        );

        if (!active) return;

        if (introComplete === 'true') {
          router.replace(token ? '/dashboard' : '/login');
          return;
        }
      } catch (error) {
        console.error('Unable to restore app state:', error);
      }

      if (active) setCheckingStartup(false);
    }

    void checkStartup();

    return () => {
      active = false;
    };
  }, []);

  if (checkingStartup) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: TEAL, fontWeight: '800' }}>
            HEAVEN GATE
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onSwipe}
      >
        <View style={{ width, height: pageHeight }}>
          <View style={[styles.pageContent, { minHeight: pageHeight }]}>
            <View style={styles.brandRow}>
              <View style={styles.logo}>
                <Text style={styles.logoText}>HG</Text>
              </View>
              <Text style={styles.brand}>HEAVEN GATE</Text>
            </View>

            <View style={styles.hero}>
              <View style={styles.introPanel}>
                <Text style={styles.introPanelKicker}>OUR PURPOSE</Text>
                <Text style={styles.introPanelText}>
                  Connecting service partners with care, clarity, and coordination.
                </Text>
              </View>
              <Text style={styles.eyebrow}>FUNERAL & TRANSPORT SERVICES</Text>
              <Text style={styles.title}>
                A helping hand{'\n'}when it matters{'\n'}
                <Text style={styles.accent}>most.</Text>
              </Text>
              <Text style={styles.description}>
                Bringing service partners together to coordinate enquiries
                with compassion, dignity, and clarity.
              </Text>
            </View>

            <View style={styles.featureCard}>
              <View style={styles.featureIcon}>
                <Text style={styles.heart}>♡</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.featureTitle}>Service with compassion</Text>
                <Text style={styles.featureDescription}>
                  A dedicated space for organising enquiries and connecting
                  families with the support they need.
                </Text>
              </View>
            </View>

            <View style={styles.valueSection}>
              <Text style={styles.sectionTitle}>Everything in one place</Text>
              <View style={styles.valueRow}>
                <ValueItem symbol="◎" title="Enquiries" />
                <ValueItem symbol="♧" title="Partners" />
                <ValueItem symbol="✓" title="Updates" />
              </View>
              <Text style={styles.valueCaption}>
                One platform. A more organised way to serve.
              </Text>
            </View>

            <View style={styles.bottomSection}>
              <PageProgress page={0} onSelect={changePage} />
              <Pressable
                onPress={() => changePage(1)}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.primaryButtonText}>Continue</Text>
                <Text style={styles.arrow}>→</Text>
              </Pressable>
              <Text style={styles.footer}>Swipe left to discover more</Text>
            </View>
          </View>
        </View>

        <View style={{ width, height: pageHeight }}>
          <View style={[styles.pageContent, { minHeight: pageHeight }]}>
            <View style={styles.brandRow}>
              <View style={styles.logo}>
                <Text style={styles.logoText}>HG</Text>
              </View>
              <Text style={styles.brand}>HEAVEN GATE</Text>
            </View>

            <View style={styles.hero}>
              <View style={styles.introPanel}>
                <Text style={styles.introPanelKicker}>A CONNECTED WORKFLOW</Text>
                <Text style={styles.introPanelText}>
                  From the first enquiry to the latest update, keep your work organised in one place.
                </Text>
              </View>
              <Text style={styles.eyebrow}>A CONNECTED SERVICE NETWORK</Text>
              <Text style={styles.title}>
                Better support.{'\n'}
                <Text style={styles.accent}>Together.</Text>
              </Text>
              <Text style={styles.description}>
                Heaven Gate helps service partners organise leads, coordinate
                their work, and follow the progress of enquiries.
              </Text>
            </View>

            <Text style={styles.sectionTitle}>How Heaven Gate works</Text>

            <View style={styles.steps}>
              <Step
                number="01"
                title="Submit an enquiry"
                description="Record service requests and the details needed for follow-up."
              />
              <Step
                number="02"
                title="Coordinate with your team"
                description="Work with the appropriate partners to manage enquiries."
              />
              <Step
                number="03"
                title="Track progress"
                description="Follow status updates and keep your activity organised."
              />
            </View>

            <View style={styles.noteCard}>
              <Text style={styles.noteTitle}>Built around your role</Text>
              <Text style={styles.noteText}>
                Associates manage their own permitted work. Team Members can
                coordinate with their authorised associates.
              </Text>
            </View>

            <View style={styles.bottomSection}>
              <PageProgress page={1} onSelect={changePage} />
              <Pressable
                onPress={async () => {
                  await SecureStore.setItemAsync(
                    'heaven_gate_intro_complete',
                    'true'
                  );
                  router.replace('/auth');
                }}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.primaryButtonText}>Get Started</Text>
                <Text style={styles.arrow}>→</Text>
              </Pressable>
              <Pressable onPress={() => changePage(0)} style={styles.backButton}>
                <Text style={styles.backText}>← Back to introduction</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ValueItem({ symbol, title }: { symbol: string; title: string }) {
  return (
    <View style={styles.valueItem}>
      <Text style={styles.valueSymbol}>{symbol}</Text>
      <Text style={styles.valueItemText}>{title}</Text>
    </View>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{number}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepDescription}>{description}</Text>
      </View>
    </View>
  );
}

function PageProgress({
  page,
  onSelect,
}: {
  page: number;
  onSelect: (page: number) => void;
}) {
  return (
    <View style={styles.progressRow}>
      {[0, 1].map((item) => (
        <Pressable key={item} onPress={() => onSelect(item)} hitSlop={10}>
          <View style={[styles.dot, page === item && styles.activeDot]} />
        </Pressable>
      ))}
      <Text style={styles.progressText}>
        {page === 0 ? '01 / 02' : '02 / 02'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  pageContent: {
    flexGrow: 1,
    paddingHorizontal: 25,
    paddingTop: 18,
    paddingBottom: 22,
    justifyContent: 'space-between',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: {
    width: 44, height: 44, borderRadius: 15, backgroundColor: TEAL,
    alignItems: 'center', justifyContent: 'center',
  },
  logoText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  brand: { color: NAVY, fontSize: 15, fontWeight: '800', letterSpacing: 2 },
  hero: { marginTop: 18 },
  heroIcon: {
    width: 78, height: 78, borderRadius: 26, backgroundColor: '#E0ECE7',
    alignItems: 'center', justifyContent: 'center', marginBottom: 23,
  },
  introPanel: {
    backgroundColor: '#E0ECE7',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D4E3DD',
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginBottom: 23,
  },
  introPanelKicker: {
    color: '#174D48',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 7,
  },
  introPanelText: {
    color: '#17324D',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
  heroSymbol: { color: TEAL, fontSize: 43 },
  goldDot: {
    position: 'absolute', width: 9, height: 9, borderRadius: 5,
    backgroundColor: '#C0A477', top: 16, right: 16,
  },
  eyebrow: {
    color: TEAL, fontSize: 10, fontWeight: '800',
    letterSpacing: 1.45, marginBottom: 13,
  },
  title: {
    color: NAVY, fontSize: 36, lineHeight: 44,
    fontWeight: '800', letterSpacing: -0.7,
  },
  accent: { color: '#357A72' },
  description: { color: MUTED, fontSize: 14, lineHeight: 23, marginTop: 15 },
  featureCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 13,
    backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: '#E5EBE8', marginTop: 20,
  },
  featureIcon: {
    width: 42, height: 42, borderRadius: 13, backgroundColor: '#E9F2EE',
    alignItems: 'center', justifyContent: 'center',
  },
  heart: { color: TEAL, fontSize: 28 },
  flex: { flex: 1 },
  featureTitle: { color: NAVY, fontSize: 14, fontWeight: '800' },
  featureDescription: { color: MUTED, fontSize: 12, lineHeight: 19, marginTop: 6 },
  valueSection: { marginTop: 20 },
  sectionTitle: { color: NAVY, fontSize: 16, fontWeight: '800', marginBottom: 12 },
  valueRow: { flexDirection: 'row', gap: 10 },
  valueItem: {
    flex: 1, backgroundColor: '#EAF1EE', borderRadius: 14,
    paddingVertical: 13, alignItems: 'center', gap: 5,
  },
  valueSymbol: { color: TEAL, fontSize: 22, fontWeight: '700' },
  valueItemText: { color: NAVY, fontSize: 11, fontWeight: '700' },
  valueCaption: { color: MUTED, fontSize: 11, textAlign: 'center', marginTop: 10 },
  steps: { gap: 18, marginTop: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 13 },
  stepNumber: {
    width: 42, height: 42, borderRadius: 14, backgroundColor: '#E0ECE7',
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumberText: { color: TEAL, fontSize: 12, fontWeight: '900' },
  stepTitle: { color: NAVY, fontSize: 14, fontWeight: '800', marginTop: 2 },
  stepDescription: { color: MUTED, fontSize: 12, lineHeight: 19, marginTop: 4 },
  noteCard: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5EBE8',
    borderRadius: 16, padding: 15, marginTop: 22,
  },
  noteTitle: { color: NAVY, fontSize: 13, fontWeight: '800' },
  noteText: { color: MUTED, fontSize: 12, lineHeight: 19, marginTop: 5 },
  bottomSection: { marginTop: 24 },
  progressRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16,
  },
  dot: { width: 7, height: 7, borderRadius: 5, backgroundColor: '#D3DEDA' },
  activeDot: { width: 25, backgroundColor: TEAL },
  progressText: { color: MUTED, fontSize: 10, fontWeight: '700', marginLeft: 'auto' },
  primaryButton: {
    height: 54, backgroundColor: TEAL, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  arrow: { color: '#FFFFFF', fontSize: 22, position: 'absolute', right: 20 },
  pressed: { opacity: 0.8 },
  footer: { color: '#87958F', textAlign: 'center', fontSize: 11, marginTop: 14 },
  backButton: { alignItems: 'center', paddingVertical: 13 },
  backText: { color: TEAL, fontSize: 12, fontWeight: '700' },
});
