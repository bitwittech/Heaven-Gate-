import { router } from 'expo-router';

import * as SecureStore from 'expo-secure-store';

import { useCallback, useEffect, useRef, useState } from 'react';

import {

    ActivityIndicator,
    Alert,
    AppState,
    BackHandler,

    KeyboardAvoidingView,

    Platform,

    Pressable,

    RefreshControl,

    ScrollView,

    StyleSheet,

    Text,

    TextInput,

    View,

} from 'react-native';



declare const process: { env: { EXPO_PUBLIC_API_URL?: string } };



const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http\://10.0.2.2:4000';



type Role = 'team_member' | 'associate' | string;

type User = { id: number; fullName: string; email: string; role: Role };

type Lead = {

    id: number;

    lead_code: string;

    customer_name: string;

    customer_phone?: string | null;

    customer_email?: string | null;

    hospital_or_location?: string | null;

    pickup_location?: string | null;

    destination?: string | null;

    scheduled_at?: string | null;

    notes?: string | null;

    status: string;

    service_amount?: number | string | null;

    commission_amount?: number | string | null;

    commission_percentage?: number | string | null;

    commission_status?: string | null;

    created_at: string;

    updated_at?: string;

    service_name: string | null;

    submitted_by: number;

    submitted_by_name: string | null;

    submitted_by_role: string | null;

    statusHistory?: StatusHistory[];

};

type StatusHistory = {

    id: number;

    old_status: string | null;

    new_status: string;

    notes: string | null;

    changed_at: string;

    changed_by_name: string | null;

};

type Associate = {

    id: number;

    full_name: string;

    email: string;

    phone: string | null;

    account_status: string;

    created_at: string;

    total_leads: number;

    completed_leads: number;

    cancelled_leads: number;

    in_progress_leads: number;

};

type Commission = {

    id: number;

    lead_id: number;

    lead_code: string;

    customer_name: string;

    service_name: string | null;

    commission_amount: number | string;

    commission_percentage: number | string;

    status: string;

    created_at: string;

    updated_at?: string;

};

type DashboardData = {

    user: User;

    stats: {

        totalLeads: number;

        completedLeads: number;

        cancelledLeads: number;

        inProgressLeads: number;

        associateCount: number;

    };

    commissions: {

        totalCount: number;

        pendingCount: number;

        approvedCount: number;

        disbursedCount: number;

        rejectedCount: number;

        totalAmount: number;

        pendingAmount: number;

        approvedAmount: number;

        disbursedAmount: number;

    };

    recentLeads: Lead[];

};

type View = 'home' | 'leads' | 'lead-detail' | 'associates' | 'associate-detail' | 'add-associate' | 'add-lead' | 'commissions' | 'profile';

type LeadFilter = 'all' | 'in_progress' | 'completed' | 'cancelled';
type ServiceType = { id: number; name: string; description?: string | null };



function formatMoney(value: number | string | null | undefined) {

    return new Intl.NumberFormat('en-IN', {

        style: 'currency', currency: 'INR', maximumFractionDigits: 2,

    }).format(Number(value) || 0);

}

function formatStatus(value: string | null | undefined) {

    return String(value || 'unknown').replaceAll('\_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

}

function formatDate(value?: string | null) {

    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

}

function statusStyle(status: string) {

    switch (status) {

        case 'completed': return styles.statusCompleted;

        case 'cancelled': return styles.statusCancelled;

        case 'service_confirmed': return styles.statusConfirmed;

        case 'under_review':

        case 'contacted':

        case 'follow_up': return styles.statusProgress;

        default: return styles.statusNew;

    }

}

function commissionStatusStyle(status: string) {

    if (status === 'paid') return styles.statusCompleted;

    if (status === 'rejected') return styles.statusCancelled;

    if (status === 'approved') return styles.statusConfirmed;

    return styles.statusProgress;

}



async function requestJson(path: string, init: RequestInit = {}) {

    const token = await SecureStore.getItemAsync('heaven_gate_token');

    if (!token) {

        router.replace('/login');

        throw new Error('Your session has ended. Please sign in again.');

    }

    const response = await fetch(`${API_URL}${path}`, {

        ...init,

        headers: {

            Accept: 'application/json',

            ...(init.body ? { 'Content-Type': 'application/json' } : {}),

            Authorization: `Bearer ${token}`,

            ...init.headers,

        },

    });

    if (response.status === 401) {

        await SecureStore.deleteItemAsync('heaven_gate_token');

        await SecureStore.deleteItemAsync('heaven_gate_user');

        router.replace('/login');

    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {

        throw new Error(result.message || `Request failed (${response.status}).`);

    }

    return result;

}



export default function DashboardScreen() {

    const [view, setView] = useState<View>('home');

    const [previousView, setPreviousView] = useState<View>('leads');
    const viewHistory = useRef<View[]>([]);
    const scrollViewRef = useRef<ScrollView | null>(null);
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const lastDashboardRefreshAt = useRef(Date.now());

    const [dashboard, setDashboard] = useState<DashboardData | null>(null);

    const [loading, setLoading] = useState(true);

    const [refreshing, setRefreshing] = useState(false);

    const [error, setError] = useState('');

    const [retry, setRetry] = useState(0);



    const [leadFilter, setLeadFilter] = useState<LeadFilter>('all');

    const [leadList, setLeadList] = useState<Lead[]>([]);

    const [leadListLoading, setLeadListLoading] = useState(false);

    const [listError, setListError] = useState('');

    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

    const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);



    const [associates, setAssociates] = useState<Associate[]>([]);

    const [associatesLoading, setAssociatesLoading] = useState(false);

    const [selectedAssociate, setSelectedAssociate] = useState<Associate | null>(null);

    const [associateLeads, setAssociateLeads] = useState<Lead[]>([]);



    const [commissionsList, setCommissionsList] = useState<Commission[]>([]);

    const [commissionsLoading, setCommissionsLoading] = useState(false);

    const [profile, setProfile] = useState({ fullName: '', phone: '', gender: '', dateOfBirth: '', address: '', payoutMethod: 'upi', upiId: '', accountHolderName: '', bankName: '', accountNumber: '', ifscCode: '' });
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileMessage, setProfileMessage] = useState('');
    const [profileError, setProfileError] = useState('');

    const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
    const [serviceTypesLoading, setServiceTypesLoading] = useState(false);
    const [selectedServiceTypeId, setSelectedServiceTypeId] = useState<number | null>(null);
    const [leadForm, setLeadForm] = useState({ customerName: '', customerPhone: '', customerEmail: '', hospitalOrLocation: '', pickupLocation: '', destination: '', scheduledAt: '', notes: '' });
    const [leadSubmitting, setLeadSubmitting] = useState(false);
    const [addLeadError, setAddLeadError] = useState('');
    const [addLeadMessage, setAddLeadMessage] = useState('');




    const [associateName, setAssociateName] = useState('');

    const [associateEmail, setAssociateEmail] = useState('');

    const [associatePhone, setAssociatePhone] = useState('');

    const [associatePassword, setAssociatePassword] = useState('');

    const [associatePasswordConfirm, setAssociatePasswordConfirm] = useState('');

    const [associateOtp, setAssociateOtp] = useState('');

    const [associateOtpSent, setAssociateOtpSent] = useState(false);

    const [associateEmailVerified, setAssociateEmailVerified] = useState(false);

    const [associateFormMessage, setAssociateFormMessage] = useState('');

    const [associateFormError, setAssociateFormError] = useState('');

    const [associateBusy, setAssociateBusy] = useState(false);



    const loadDashboard = useCallback(async (isRefresh = false) => {

        if (isRefresh) {
            setRefreshing(true);
            lastDashboardRefreshAt.current = Date.now();
        } else setLoading(true);

        setError('');

        try {

            const result = await requestJson('/api/member/dashboard');

            if (!result.data) throw new Error('Dashboard data was missing from the server response.');

            setDashboard(result.data as DashboardData);

            lastDashboardRefreshAt.current = Date.now();

            await SecureStore.setItemAsync('heaven_gate_user', JSON.stringify(result.data.user));

        } catch (err) {

            setError(err instanceof TypeError

                ? 'Cannot connect to Heaven Gate. Check that the backend is running and the API URL is correct.'

                : err instanceof Error ? err.message : 'Could not load your dashboard.');

        } finally {

            setLoading(false);

            setRefreshing(false);

        }

    }, []);

    const navigateTo = useCallback((nextView: View) => {
        if (nextView !== view) viewHistory.current.push(view);
        setView(nextView);
    }, [view]);

    const goBack = useCallback(() => {
        if (view === 'home') return;
        const previous = viewHistory.current.pop() ?? 'home';
        setView(previous);
        if (previous === 'home') void loadDashboard(true);
    }, [view, loadDashboard]);

    useEffect(() => { void loadDashboard(); }, [loadDashboard, retry]);

    // Refresh the dashboard every hour while Home is visible, and after resuming the app.
    useEffect(() => {
        const maybeRefresh = () => {
            if (view === 'home' && AppState.currentState === 'active' &&
                Date.now() - lastDashboardRefreshAt.current >= 60 * 60 * 1000) {
                void loadDashboard(true);
            }
        };
        const interval = setInterval(maybeRefresh, 60 * 1000);
        const appStateSubscription = AppState.addEventListener('change', (state) => {
            if (state === 'active' && view === 'home' &&
                Date.now() - lastDashboardRefreshAt.current >= 60 * 60 * 1000) {
                void loadDashboard(true);
            }
        });
        return () => {
            clearInterval(interval);
            appStateSubscription.remove();
        };
    }, [view, loadDashboard]);

    // Android system back button/gesture uses the same in-dashboard history.
    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (view === 'home') return false;
            goBack();
            return true;
        });
        return () => subscription.remove();
    }, [view, goBack]);

    // Return Home to the top so users immediately see the latest leads and dashboard cards.
    useEffect(() => {
        if (view === 'home') {
            requestAnimationFrame(() => scrollViewRef.current?.scrollTo({ y: 0, animated: true }));
        }
    }, [view]);



    async function logout() {

        await SecureStore.deleteItemAsync('heaven_gate_token');

        await SecureStore.deleteItemAsync('heaven_gate_user');

        router.replace('/login');

    }



    async function openLeads(filter: LeadFilter = 'all') {

        navigateTo('leads');

        setLeadFilter(filter);

        setListError('');

        setLeadListLoading(true);

        setSelectedAssociate(null);

        try {

            const result = await requestJson(`/api/member/leads?status=${encodeURIComponent(filter)}`);

            setLeadList(Array.isArray(result.data) ? result.data : []);

        } catch (err) {

            setListError(err instanceof Error ? err.message : 'Unable to load leads.');

            setLeadList([]);

        } finally {

            setLeadListLoading(false);

        }

    }



    async function openLead(leadId: number) {

        setPreviousView(view);

        navigateTo('lead-detail');

        setSelectedLeadId(leadId);

        setSelectedLead(null);

        setListError('');

        try {

            const result = await requestJson(`/api/member/leads/${leadId}`);

            setSelectedLead(result.data as Lead);

        } catch (err) {

            setListError(err instanceof Error ? err.message : 'Unable to load lead details.');

        }

    }



    async function refreshAssociatesList() {
        setListError('');
        setAssociatesLoading(true);
        try {
            const result = await requestJson('/api/member/associates');
            setAssociates(Array.isArray(result.data) ? result.data : []);
        } catch (err) {
            setListError(err instanceof Error ? err.message : 'Unable to load Associates.');
            setAssociates([]);
        } finally {
            setAssociatesLoading(false);
        }
    }

    async function openAssociates() {
        navigateTo('associates');
        await refreshAssociatesList();
    }


    async function openAssociate(associate: Associate) {

        setSelectedAssociate(associate);

        navigateTo('associate-detail');

        setAssociateLeads([]);

        setListError('');

        setLeadListLoading(true);

        try {

            const result = await requestJson(`/api/member/associates/${associate.id}/leads`);

            setAssociateLeads(Array.isArray(result.data) ? result.data : []);

        } catch (err) {

            setListError(err instanceof Error ? err.message : 'Unable to load Associate activity.');

        } finally {

            setLeadListLoading(false);

        }

    }



    async function openCommissions() {

        navigateTo('commissions');

        setListError('');

        setCommissionsLoading(true);

        try {

            const result = await requestJson('/api/member/commissions');

            setCommissionsList(Array.isArray(result.data) ? result.data : []);

        } catch (err) {

            setListError(err instanceof Error ? err.message : 'Unable to load commissions.');

            setCommissionsList([]);

        } finally {

            setCommissionsLoading(false);

        }

    }




    function resetLeadForm() {
        setLeadForm({ customerName: '', customerPhone: '', customerEmail: '', hospitalOrLocation: '', pickupLocation: '', destination: '', scheduledAt: '', notes: '' });
        setAddLeadError('');
        setAddLeadMessage('');
    }

    async function openAddLead() {
        navigateTo('add-lead');
        resetLeadForm();
        setServiceTypesLoading(true);
        setSelectedServiceTypeId(null);
        try {
            const result = await requestJson('/api/member/service-types');
            const availableServices = Array.isArray(result.data) ? result.data as ServiceType[] : [];
            setServiceTypes(availableServices);
            if (availableServices.length > 0) setSelectedServiceTypeId(Number(availableServices[0].id));
            else setAddLeadError('No active services are available right now. Please contact the admin.');
        } catch (err) {
            setServiceTypes([]);
            setAddLeadError(err instanceof Error ? err.message : 'Unable to load available services.');
        } finally {
            setServiceTypesLoading(false);
        }
    }

    async function createLead() {
        const customerName = leadForm.customerName.trim();
        const customerPhone = leadForm.customerPhone.trim();
        const customerEmail = leadForm.customerEmail.trim().toLowerCase();
        if (customerName.length < 2) { setAddLeadError('Enter the customer’s full name.'); return; }
        if (customerPhone.length < 5) { setAddLeadError('Enter a valid customer phone number.'); return; }
        if (!selectedServiceTypeId) { setAddLeadError('Select the required service type.'); return; }
        if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) { setAddLeadError('Enter a valid customer email address.'); return; }

        setLeadSubmitting(true);
        setAddLeadError('');
        setAddLeadMessage('');
        try {
            const result = await requestJson('/api/member/leads', {
                method: 'POST',
                body: JSON.stringify({
                    customer_name: customerName,
                    customer_phone: customerPhone,
                    customer_email: customerEmail || null,
                    service_type_id: selectedServiceTypeId,
                    hospital_or_location: leadForm.hospitalOrLocation.trim() || null,
                    pickup_location: leadForm.pickupLocation.trim() || null,
                    destination: leadForm.destination.trim() || null,
                    scheduled_at: leadForm.scheduledAt.trim() || null,
                    notes: leadForm.notes.trim() || null,
                }),
            });
            const successMessage = `${result.message || 'Lead created successfully.'}${result.data?.lead_code ? ` Lead ID: ${result.data.lead_code}.` : ''} It is now available in the Admin Dashboard.`;
            setAddLeadMessage(successMessage);
            setLeadForm({ customerName: '', customerPhone: '', customerEmail: '', hospitalOrLocation: '', pickupLocation: '', destination: '', scheduledAt: '', notes: '' });
            // Refresh immediately: the newest five leads are returned first by the backend.
            await loadDashboard(true);
            viewHistory.current = [];
            setView('home');
            Alert.alert('Lead submitted successfully', successMessage);
        } catch (err) {
            setAddLeadError(err instanceof Error ? err.message : 'Unable to create lead.');
        } finally {
            setLeadSubmitting(false);
        }
    }

    async function openProfile() {
        navigateTo('profile'); setProfileLoading(true); setProfileError(''); setProfileMessage('');
        try {
            const result = await requestJson('/api/member/profile');
            const p = result.data || {};
            setProfile({ fullName: p.fullName || userSafeName(), phone: p.phone || '', gender: p.gender || '', dateOfBirth: p.dateOfBirth || '', address: p.address || '', payoutMethod: p.payoutMethod || 'upi', upiId: p.upiId || '', accountHolderName: p.accountHolderName || '', bankName: p.bankName || '', accountNumber: p.accountNumber || '', ifscCode: p.ifscCode || '' });
        } catch (err) { setProfileError(err instanceof Error ? err.message : 'Unable to load profile.'); }
        finally { setProfileLoading(false); }
    }
    function userSafeName() { return dashboard?.user.fullName || ''; }
    async function saveProfile() {
        setProfileSaving(true); setProfileError(''); setProfileMessage('');
        try {
            const result = await requestJson('/api/member/profile', { method: 'PUT', body: JSON.stringify(profile) });
            setDashboard(current => current ? {
                ...current,
                user: { ...current.user, fullName: profile.fullName.trim() },
            } : current);
            viewHistory.current = [];
            await loadDashboard(true);
            setView('home');
            Alert.alert('Profile saved', result.message || 'Your profile and payout details have been saved.');
        } catch (err) { setProfileError(err instanceof Error ? err.message : 'Unable to save profile.'); }
        finally { setProfileSaving(false); }
    }

    function resetAssociateForm() {

        setAssociateName(''); setAssociateEmail(''); setAssociatePhone('');

        setAssociatePassword(''); setAssociatePasswordConfirm(''); setAssociateOtp('');

        setAssociateOtpSent(false); setAssociateEmailVerified(false);

        setAssociateFormError(''); setAssociateFormMessage('');

    }



    async function sendAssociateOtp() {

        const email = associateEmail.trim().toLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {

            setAssociateFormError('Enter the Associate’s valid email address first.'); return;

        }

        setAssociateBusy(true); setAssociateFormError(''); setAssociateFormMessage('');

        try {

            const result = await fetch(`${API_URL}/api/auth/otp/email/send`, {

                method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },

                body: JSON.stringify({ email }),

            });

            const data = await result.json().catch(() => ({}));

            if (!result.ok || data.success === false) throw new Error(data.message || 'Unable to send the email OTP.');

            setAssociateOtpSent(true); setAssociateEmailVerified(false);

            setAssociateFormMessage('OTP sent. Ask the Associate to check their email and share the code with you.');

        } catch (err) {

            setAssociateFormError(err instanceof Error ? err.message : 'Unable to send OTP.');

        } finally { setAssociateBusy(false); }

    }



    async function verifyAssociateOtp() {

        const email = associateEmail.trim().toLowerCase();

        if (!/^\d{6}$/.test(associateOtp.trim())) {

            setAssociateFormError('Enter the six-digit OTP.'); return;

        }

        setAssociateBusy(true); setAssociateFormError(''); setAssociateFormMessage('');

        try {

            const result = await fetch(`${API_URL}/api/auth/otp/email/verify`, {

                method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },

                body: JSON.stringify({ email, otp: associateOtp.trim() }),

            });

            const data = await result.json().catch(() => ({}));

            if (!result.ok || data.success === false || !data.verified) throw new Error(data.message || 'Email verification failed.');

            setAssociateEmailVerified(true);

            setAssociateFormMessage('Email verified. You can now create the Associate account.');

        } catch (err) {

            setAssociateFormError(err instanceof Error ? err.message : 'Unable to verify OTP.');

        } finally { setAssociateBusy(false); }

    }



    async function createAssociate() {

        if (associateName.trim().length < 2) { setAssociateFormError('Enter the Associate’s full name.'); return; }

        if (!associateEmailVerified) { setAssociateFormError('Verify the Associate’s email before creating the account.'); return; }

        if (associatePassword.length < 8) { setAssociateFormError('Password must contain at least 8 characters.'); return; }

        if (associatePassword !== associatePasswordConfirm) { setAssociateFormError('Passwords do not match.'); return; }

        setAssociateBusy(true); setAssociateFormError(''); setAssociateFormMessage('');

        try {

            const result = await requestJson('/api/member/associates', {

                method: 'POST',

                body: JSON.stringify({

                    fullName: associateName.trim(),

                    email: associateEmail.trim().toLowerCase(),

                    phone: associatePhone.trim(),

                    password: associatePassword,

                }),

            });

            setAssociateFormMessage(result.message || 'Associate added successfully.');

            resetAssociateForm();

            await loadDashboard(true);
            if (viewHistory.current[viewHistory.current.length - 1] === 'associates') viewHistory.current.pop();
            setView('associates');
            await refreshAssociatesList();

        } catch (err) {

            setAssociateFormError(err instanceof Error ? err.message : 'Unable to create Associate.');

        } finally { setAssociateBusy(false); }

    }



    if (loading && !dashboard) {

        return <View style={styles.center}><ActivityIndicator size="large" color="#174D48" /><Text style={styles.muted}>Loading your Heaven Gate dashboard…</Text></View>;

    }

    if (error && !dashboard) {

        return <View style={styles.center}><Text style={styles.title}>Unable to load dashboard</Text><Text style={styles.muted}>{error}</Text><Pressable style={styles.button} onPress={() => setRetry((value) => value + 1)}><Text style={styles.buttonText}>Try Again</Text></Pressable><Pressable onPress={logout} style={styles.logoutLink}><Text style={styles.linkText}>Sign Out</Text></Pressable></View>;

    }

    if (!dashboard) return null;



    const { user, stats, commissions, recentLeads } = dashboard;

    const isTeamMember = user.role === 'team_member';



    function pageHeader(title: string, subtitle?: string) {

        const backTarget: View = viewHistory.current[viewHistory.current.length - 1] ?? 'home';
        const backLabel = backTarget === 'home' ? 'Dashboard'
            : backTarget === 'associates' ? 'Associates'
                : backTarget === 'associate-detail' ? 'Associate activity'
                    : backTarget === 'commissions' ? 'Commissions'
                        : backTarget === 'profile' ? 'My Profile'
                            : backTarget === 'add-lead' ? 'Add Lead'
                                : 'Leads';
        return <View style={styles.pageHeader}>

            <Pressable style={styles.backButton} onPress={goBack}><Text style={styles.backButtonText}>‹  {backLabel}</Text></Pressable>

            <Text style={styles.pageTitle}>{title}</Text>

            {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}

        </View>;

    }



    function leadCard(lead: Lead, compact = false) {

        return <Pressable key={lead.id} onPress={() => void openLead(lead.id)} style={({ pressed }) => [styles.leadCard, pressed && styles.pressedCard]}>

            <View style={styles.leadTopRow}>

                <Text style={styles.leadCode}>{lead.lead_code || `Lead #${lead.id}`}</Text>

                <View style={[styles.statusPill, statusStyle(lead.status)]}><Text style={styles.statusText}>{formatStatus(lead.status)}</Text></View>

            </View>

            <Text style={styles.leadCustomer}>{lead.customer_name}</Text>

            <Text style={styles.leadService}>{lead.service_name || 'Service not specified'}</Text>

            {isTeamMember && lead.submitted_by_role === 'associate' && lead.submitted_by_name ? <Text style={styles.submittedBy}>Submitted by {lead.submitted_by_name}</Text> : null}

            <Text style={styles.leadDate}>{compact ? 'Tap to see complete lead details' : `Added ${formatDate(lead.created_at)}`}</Text>

            <Text style={styles.cardAction}>View details  ›</Text>

        </Pressable>;

    }



    return (

        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

            <ScrollView
                ref={scrollViewRef}
                style={styles.scroll}
                contentContainerStyle={styles.container}
                keyboardShouldPersistTaps="handled"
                onTouchStart={(event) => {
                    const touch = event.nativeEvent.touches[0];
                    touchStart.current = touch ? { x: touch.pageX, y: touch.pageY } : null;
                }}
                onTouchEnd={(event) => {
                    const start = touchStart.current;
                    const touch = event.nativeEvent.changedTouches[0];
                    touchStart.current = null;
                    if (!start || !touch || view === 'home') return;
                    const horizontalDistance = touch.pageX - start.x;
                    const verticalDistance = Math.abs(touch.pageY - start.y);
                    if (start.x <= 24 && horizontalDistance >= 90 && verticalDistance <= 45) goBack();
                }}
                refreshControl={view === 'home' ? <RefreshControl refreshing={refreshing} onRefresh={() => void loadDashboard(true)} tintColor="#174D48" /> : undefined}
            >

                {view === 'home' ? <>

                    <View style={styles.headerRow}>

                        <View style={styles.brandBlock}><View style={styles.logo}><Text style={styles.logoText}>HG</Text></View><View style={styles.brandCopy}><Text style={styles.brand}>HEAVEN GATE</Text><Text style={styles.eyebrow}>MEMBER PORTAL</Text></View></View>

                        <Pressable onPress={() => void loadDashboard(true)} style={styles.refreshButton}><Text style={styles.refreshText}>Refresh</Text></Pressable>

                    </View>

                    <View style={styles.greetingBlock}><Text style={styles.eyebrow}>YOUR OVERVIEW</Text><Text style={styles.homeTitle}>Welcome, {user.fullName || 'Member'}</Text><Text style={styles.muted}>Track your leads, service progress, and commission updates in one place.</Text></View>

                    {error ? <View style={styles.warningBox}><Text style={styles.warningText}>{error}</Text><Pressable onPress={() => void loadDashboard(true)}><Text style={styles.warningAction}>Retry</Text></Pressable></View> : null}



                    <Pressable style={styles.button} onPress={() => void openAddLead()}><Text style={styles.buttonText}>＋  Add New Lead</Text></Pressable>

                    <View style={styles.sectionHeadingRow}><Text style={styles.sectionTitle}>Lead overview</Text><Text style={styles.sectionHint}>Tap a card to view leads</Text></View>

                    <View style={styles.statsGrid}>

                        <StatCard label="Total leads" value={stats.totalLeads} accent="green" onPress={() => void openLeads('all')} />

                        <StatCard label="In progress" value={stats.inProgressLeads} accent="blue" onPress={() => void openLeads('in_progress')} />

                        <StatCard label="Completed" value={stats.completedLeads} accent="gold" onPress={() => void openLeads('completed')} />

                        <StatCard label="Cancelled" value={stats.cancelledLeads} accent="red" onPress={() => void openLeads('cancelled')} />

                    </View>



                    <View style={styles.sectionHeadingRow}><Text style={styles.sectionTitle}>Recent leads</Text><Pressable onPress={() => void openLeads('all')}><Text style={styles.inlineAction}>View all  ›</Text></Pressable></View>
                    <Text style={styles.sectionHint}>Latest 5 leads · refreshes hourly and after you submit a lead.</Text>
                    {recentLeads.length === 0 ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No leads yet</Text><Text style={styles.muted}>Leads you submit will appear here. Their status is managed by the admin.</Text><Pressable style={styles.outlineButton} onPress={() => void openLeads('all')}><Text style={styles.outlineButtonText}>View My Leads</Text></Pressable></View> : <View style={styles.leadsList}>{recentLeads.map((lead) => leadCard(lead, true))}</View>}

                    <View style={styles.sectionHeadingRow}><Text style={styles.sectionTitle}>My commissions & payouts</Text><Pressable onPress={() => void openCommissions()}><Text style={styles.inlineAction}>View all  ›</Text></Pressable></View>

                    <Pressable style={({ pressed }) => [styles.moneyCard, pressed && styles.pressedCard]} onPress={() => void openCommissions()}>

                        <Text style={styles.moneyLabel}>Total commission recorded</Text><Text style={styles.moneyValue}>{formatMoney(commissions.totalAmount)}</Text><View style={styles.moneyDivider} />

                        <View style={styles.moneyRow}><MoneyStat label="Pending" amount={commissions.pendingAmount} count={commissions.pendingCount} /><MoneyStat label="Approved" amount={commissions.approvedAmount} count={commissions.approvedCount} /><MoneyStat label="Disbursed" amount={commissions.disbursedAmount} count={commissions.disbursedCount} /></View>

                        {commissions.rejectedCount > 0 ? <Text style={styles.rejectedNote}>{commissions.rejectedCount} rejected commission{commissions.rejectedCount === 1 ? '' : 's'}</Text> : null}

                        <Text style={styles.cardAction}>Open commission history  ›</Text>

                    </Pressable>



                    {isTeamMember ? <Pressable style={({ pressed }) => [styles.associateCard, pressed && styles.pressedCard]} onPress={() => void openAssociates()}>

                        <View style={styles.associateIcon}><Text style={styles.associateIconText}>TM</Text></View>

                        <View style={styles.associateCopy}><Text style={styles.associateTitle}>My Associates</Text><Text style={styles.associateDescription}>Add Associates and check their leads and service progress.</Text></View>

                        <View style={styles.associateRight}><Text style={styles.associateCount}>{stats.associateCount}</Text><Text style={styles.cardAction}>Open  ›</Text></View>

                    </Pressable> : null}

                    <View style={styles.noticeBox}><Text style={styles.noticeTitle}>How lead updates work</Text><Text style={styles.noticeText}>The admin manages lead statuses. This app reads the same records, so refresh after an admin update. A commission is recorded only when a service is completed; “Disbursed” means the admin has marked the commission as paid.</Text></View>

                    <View style={styles.accountCard}><Text style={styles.accountLabel}>SIGNED-IN ACCOUNT</Text><Text style={styles.accountName}>{user.fullName}</Text><Text style={styles.accountEmail}>{user.email}</Text><Text style={styles.roleBadge}>{formatStatus(user.role)}</Text></View>
                    <Pressable style={styles.outlineButton} onPress={() => void openProfile()}><Text style={styles.outlineButtonText}>My Profile & Payout Details  ›</Text></Pressable>

                    <Pressable style={styles.button} onPress={logout}><Text style={styles.buttonText}>Log Out</Text></Pressable>

                    <Text style={styles.footerText}>Heaven Gate · A helping hand when it matters most.</Text>

                </> : null}



                {view === 'leads' ? <>

                    {pageHeader('My Leads', 'Statuses are synced with the Admin Dashboard.')}

                    <View style={styles.filterRow}>

                        {([['all', 'All'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']] as [LeadFilter, string][]).map(([filter, label]) => <Pressable key={filter} onPress={() => void openLeads(filter)} style={[styles.filterChip, leadFilter === filter && styles.filterChipActive]}><Text style={[styles.filterChipText, leadFilter === filter && styles.filterChipTextActive]}>{label}</Text></Pressable>)}

                    </View>

                    {listError ? <ErrorBox message={listError} onRetry={() => void openLeads(leadFilter)} /> : null}

                    {leadListLoading ? <Loader label="Loading leads…" /> : leadList.length === 0 ? <EmptyState title="No matching leads" message="There are no leads matching this filter yet." /> : <View style={styles.leadsList}>{leadList.map((lead) => leadCard(lead))}</View>}

                </> : null}



                {view === 'add-lead' ? <>
                    {pageHeader('Add New Lead', 'Submit a customer enquiry for the Heaven Gate team to review.')}
                    {serviceTypesLoading ? <Loader label="Loading available services…" /> : <View style={styles.formCard}>
                        <FieldLabel text="Service type *" />
                        {serviceTypes.length === 0 ? <EmptyState title="No active services" message="Ask the admin to activate a service type before adding a lead." /> : <View style={styles.filterRow}>{serviceTypes.map(service => <Pressable key={service.id} onPress={() => setSelectedServiceTypeId(service.id)} style={[styles.filterChip, selectedServiceTypeId === service.id && styles.filterChipActive]}><Text style={[styles.filterChipText, selectedServiceTypeId === service.id && styles.filterChipTextActive]}>{service.name}</Text></Pressable>)}</View>}
                        <FieldLabel text="Customer full name *" /><TextInput value={leadForm.customerName} onChangeText={v => setLeadForm(p => ({ ...p, customerName: v }))} placeholder="Enter customer name" placeholderTextColor="#94A3B8" autoCapitalize="words" style={styles.input} editable={!leadSubmitting} />
                        <FieldLabel text="Customer phone *" /><TextInput value={leadForm.customerPhone} onChangeText={v => setLeadForm(p => ({ ...p, customerPhone: v }))} placeholder="Enter phone number" placeholderTextColor="#94A3B8" keyboardType="phone-pad" style={styles.input} editable={!leadSubmitting} />
                        <FieldLabel text="Customer email (optional)" /><TextInput value={leadForm.customerEmail} onChangeText={v => setLeadForm(p => ({ ...p, customerEmail: v }))} placeholder="customer@example.com" placeholderTextColor="#94A3B8" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.input} editable={!leadSubmitting} />
                        <FieldLabel text="Hospital or location (optional)" /><TextInput value={leadForm.hospitalOrLocation} onChangeText={v => setLeadForm(p => ({ ...p, hospitalOrLocation: v }))} placeholder="Hospital / customer location" placeholderTextColor="#94A3B8" style={styles.input} editable={!leadSubmitting} />
                        <FieldLabel text="Pickup location (optional)" /><TextInput value={leadForm.pickupLocation} onChangeText={v => setLeadForm(p => ({ ...p, pickupLocation: v }))} placeholder="Pickup address" placeholderTextColor="#94A3B8" style={styles.input} editable={!leadSubmitting} />
                        <FieldLabel text="Destination (optional)" /><TextInput value={leadForm.destination} onChangeText={v => setLeadForm(p => ({ ...p, destination: v }))} placeholder="Destination address" placeholderTextColor="#94A3B8" style={styles.input} editable={!leadSubmitting} />
                        <FieldLabel text="Scheduled date and time (optional)" /><TextInput value={leadForm.scheduledAt} onChangeText={v => setLeadForm(p => ({ ...p, scheduledAt: v }))} placeholder="YYYY-MM-DD HH:MM" placeholderTextColor="#94A3B8" autoCapitalize="none" style={styles.input} editable={!leadSubmitting} />
                        <Text style={styles.formHint}>Use 24-hour time, for example: 2026-10-29 14:30. Leave blank if not scheduled yet.</Text>
                        <FieldLabel text="Additional notes (optional)" /><TextInput value={leadForm.notes} onChangeText={v => setLeadForm(p => ({ ...p, notes: v }))} placeholder="Relevant details for the team" placeholderTextColor="#94A3B8" multiline style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]} editable={!leadSubmitting} />
                        {addLeadError ? <Text style={styles.formError}>{addLeadError}</Text> : null}
                        {addLeadMessage ? <View style={styles.noticeBox}><Text style={styles.noticeTitle}>Lead submitted successfully</Text><Text style={styles.noticeText}>{addLeadMessage}</Text><Pressable style={styles.outlineButton} onPress={() => void openLeads('all')}><Text style={styles.outlineButtonText}>View My Leads</Text></Pressable></View> : null}
                        <Text style={styles.formHint}>New leads are saved with status “New”. The admin manages the status and any service amount. Commission eligibility is calculated by the backend when the service is completed.</Text>
                        <Pressable style={[styles.button, (leadSubmitting || serviceTypes.length === 0) && styles.disabledButton]} disabled={leadSubmitting || serviceTypes.length === 0} onPress={() => void createLead()}>{leadSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Submit Lead</Text>}</Pressable>
                    </View>}
                </> : null}

                {view === 'lead-detail' ? <>

                    {pageHeader('Lead details', 'Read-only details from the shared lead record.')}

                    <Pressable style={styles.backButtonInline} onPress={goBack}><Text style={styles.backButtonText}>‹  Back to {previousView === 'associate-detail' ? 'Associate' : previousView === 'home' ? 'Dashboard' : previousView === 'commissions' ? 'Commissions' : 'leads'}</Text></Pressable>

                    {!selectedLead ? (listError ? <ErrorBox message={listError} onRetry={() => selectedLead ? void openLead(selectedLead.id) : undefined} /> : <Loader label="Loading lead details…" />) : <>

                        <View style={styles.detailCard}>

                            <View style={styles.leadTopRow}><Text style={styles.leadCode}>{selectedLead.lead_code || `Lead #${selectedLead.id}`}</Text><View style={[styles.statusPill, statusStyle(selectedLead.status)]}><Text style={styles.statusText}>{formatStatus(selectedLead.status)}</Text></View></View>

                            <Text style={styles.detailCustomer}>{selectedLead.customer_name}</Text>

                            <DetailRow label="Service" value={selectedLead.service_name} />

                            <DetailRow label="Customer phone" value={selectedLead.customer_phone} />

                            <DetailRow label="Customer email" value={selectedLead.customer_email} />

                            <DetailRow label="Hospital / location" value={selectedLead.hospital_or_location} />

                            <DetailRow label="Pickup location" value={selectedLead.pickup_location} />

                            <DetailRow label="Destination" value={selectedLead.destination} />

                            <DetailRow label="Scheduled at" value={selectedLead.scheduled_at ? formatDate(selectedLead.scheduled_at) : null} />

                            <DetailRow label="Submitted by" value={selectedLead.submitted_by_name} />

                            <DetailRow label="Submitted on" value={formatDate(selectedLead.created_at)} />

                            <DetailRow label="Last updated" value={formatDate(selectedLead.updated_at)} />

                            <DetailRow label="Final service amount" value={selectedLead.service_amount == null ? null : formatMoney(selectedLead.service_amount)} />

                            {selectedLead.commission_status ? <DetailRow label="Commission status" value={formatStatus(selectedLead.commission_status)} /> : null}

                            {selectedLead.commission_amount != null ? <DetailRow label="Commission amount" value={formatMoney(selectedLead.commission_amount)} /> : null}

                            {selectedLead.notes ? <View style={styles.notesBlock}><Text style={styles.detailLabel}>Notes</Text><Text style={styles.detailValue}>{selectedLead.notes}</Text></View> : null}

                        </View>

                        <Text style={styles.sectionTitle}>Status history</Text>

                        {!selectedLead.statusHistory?.length ? <EmptyState title="No status history yet" message="Updates made by admin will appear here when available." /> : selectedLead.statusHistory.map((item) => <View key={item.id} style={styles.historyCard}><View style={styles.leadTopRow}><Text style={styles.historyStatus}>{formatStatus(item.new_status)}</Text><Text style={styles.leadDate}>{formatDate(item.changed_at)}</Text></View>{item.old_status ? <Text style={styles.detailLabel}>Previous: {formatStatus(item.old_status)}</Text> : null}{item.changed_by_name ? <Text style={styles.leadService}>Updated by {item.changed_by_name}</Text> : null}{item.notes ? <Text style={styles.detailValue}>{item.notes}</Text> : null}</View>)}

                    </>}

                </> : null}



                {view === 'associates' ? <>

                    {pageHeader('My Associates', 'Add and manage the Associates linked to your account.')}

                    <Pressable style={styles.button} onPress={() => { resetAssociateForm(); navigateTo('add-associate'); }}><Text style={styles.buttonText}>＋  Add Associate</Text></Pressable>

                    {listError ? <ErrorBox message={listError} onRetry={() => void openAssociates()} /> : null}

                    {associatesLoading ? <Loader label="Loading Associates…" /> : associates.length === 0 ? <EmptyState title="No Associates yet" message="Add an Associate and their account will be linked to you automatically." /> : <View style={styles.leadsList}>{associates.map((associate) => <Pressable key={associate.id} onPress={() => void openAssociate(associate)} style={({ pressed }) => [styles.associateListCard, pressed && styles.pressedCard]}>

                        <View style={styles.associateListHeader}><View style={styles.avatar}><Text style={styles.avatarText}>{associate.full_name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase()}</Text></View><View style={styles.associateCopy}><Text style={styles.associateName}>{associate.full_name}</Text><Text style={styles.leadService}>{associate.email}</Text><Text style={styles.leadService}>{associate.phone || 'No phone added'}</Text></View><View style={[styles.statusPill, associate.account_status === 'active' ? styles.statusCompleted : styles.statusCancelled]}><Text style={styles.statusText}>{formatStatus(associate.account_status)}</Text></View></View>

                        <View style={styles.miniStatsRow}><MiniStat label="Total" value={associate.total_leads} /><MiniStat label="In progress" value={associate.in_progress_leads} /><MiniStat label="Completed" value={associate.completed_leads} /><MiniStat label="Cancelled" value={associate.cancelled_leads} /></View>

                        <Text style={styles.cardAction}>View Associate activity  ›</Text>

                    </Pressable>)}</View>}

                </> : null}



                {view === 'associate-detail' ? <>

                    {pageHeader('Associate activity', selectedAssociate?.full_name || 'Associate details')}

                    <Pressable style={styles.backButtonInline} onPress={() => void openAssociates()}><Text style={styles.backButtonText}>‹  Back to Associates</Text></Pressable>

                    {selectedAssociate ? <View style={styles.detailCard}><Text style={styles.detailCustomer}>{selectedAssociate.full_name}</Text><DetailRow label="Email" value={selectedAssociate.email} /><DetailRow label="Phone" value={selectedAssociate.phone} /><DetailRow label="Account status" value={formatStatus(selectedAssociate.account_status)} /><View style={styles.miniStatsRow}><MiniStat label="Total" value={selectedAssociate.total_leads} /><MiniStat label="In progress" value={selectedAssociate.in_progress_leads} /><MiniStat label="Completed" value={selectedAssociate.completed_leads} /><MiniStat label="Cancelled" value={selectedAssociate.cancelled_leads} /></View></View> : null}

                    <Text style={styles.sectionTitle}>Their submitted leads</Text>

                    {listError ? <ErrorBox message={listError} onRetry={() => selectedAssociate && void openAssociate(selectedAssociate)} /> : null}

                    {leadListLoading ? <Loader label="Loading Associate activity…" /> : associateLeads.length === 0 ? <EmptyState title="No submitted leads" message="When this Associate submits leads, their records and admin-updated statuses will appear here." /> : <View style={styles.leadsList}>{associateLeads.map((lead) => leadCard(lead))}</View>}

                </> : null}



                {view === 'add-associate' ? <>

                    {pageHeader('Add Associate', 'The new Associate will be linked to your Team Member account.')}

                    <Pressable style={styles.backButtonInline} onPress={() => void openAssociates()}><Text style={styles.backButtonText}>‹  Back to Associates</Text></Pressable>

                    <View style={styles.formCard}>

                        <FieldLabel text="Associate full name" /><TextInput value={associateName} onChangeText={setAssociateName} placeholder="Enter full name" placeholderTextColor="#94A3B8" autoCapitalize="words" style={styles.input} editable={!associateBusy} />

                        <FieldLabel text="Associate email address" /><TextInput value={associateEmail} onChangeText={(value) => { setAssociateEmail(value); setAssociateOtpSent(false); setAssociateEmailVerified(false); setAssociateOtp(''); setAssociateFormMessage(''); setAssociateFormError(''); }} placeholder="associate\@example.com" placeholderTextColor="#94A3B8" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.input} editable={!associateBusy && !associateEmailVerified} />

                        <Pressable style={[styles.outlineButton, associateBusy && styles.disabledButton]} disabled={associateBusy || associateEmailVerified} onPress={() => void sendAssociateOtp()}><Text style={styles.outlineButtonText}>{associateEmailVerified ? 'Email verified ✓' : associateOtpSent ? 'Resend email OTP' : 'Send email OTP'}</Text></Pressable>

                        {associateOtpSent && !associateEmailVerified ? <><FieldLabel text="Email OTP" /><TextInput value={associateOtp} onChangeText={setAssociateOtp} placeholder="Enter 6-digit OTP" placeholderTextColor="#94A3B8" keyboardType="number-pad" maxLength={6} style={styles.input} editable={!associateBusy} /><Pressable style={[styles.outlineButton, associateBusy && styles.disabledButton]} disabled={associateBusy} onPress={() => void verifyAssociateOtp()}><Text style={styles.outlineButtonText}>Verify email</Text></Pressable></> : null}

                        <FieldLabel text="Phone number (optional)" /><TextInput value={associatePhone} onChangeText={setAssociatePhone} placeholder="Enter phone number" placeholderTextColor="#94A3B8" keyboardType="phone-pad" style={styles.input} editable={!associateBusy} />

                        <FieldLabel text="Initial password (min. 8 characters)" /><TextInput value={associatePassword} onChangeText={setAssociatePassword} placeholder="Create initial password" placeholderTextColor="#94A3B8" secureTextEntry style={styles.input} editable={!associateBusy} autoCapitalize="none" />

                        <FieldLabel text="Confirm password" /><TextInput value={associatePasswordConfirm} onChangeText={setAssociatePasswordConfirm} placeholder="Re-enter password" placeholderTextColor="#94A3B8" secureTextEntry style={styles.input} editable={!associateBusy} autoCapitalize="none" />

                        {associateFormError ? <Text style={styles.formError}>{associateFormError}</Text> : null}

                        {associateFormMessage ? <Text style={styles.formSuccess}>{associateFormMessage}</Text> : null}

                        <Text style={styles.formHint}>Email verification is required. Ask the Associate to check their inbox and provide the OTP. Phone OTP is not required at this stage.</Text>

                        <Pressable style={[styles.button, (associateBusy || !associateEmailVerified) && styles.disabledButton]} disabled={associateBusy || !associateEmailVerified} onPress={() => void createAssociate()}>{associateBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Create Associate account</Text>}</Pressable>

                    </View>

                </> : null}



                {view === 'commissions' ? <>

                    {pageHeader('My Commissions & Payouts', 'Commission records are generated by the backend after service completion.')}

                    {listError ? <ErrorBox message={listError} onRetry={() => void openCommissions()} /> : null}

                    {commissionsLoading ? <Loader label="Loading commission records…" /> : commissionsList.length === 0 ? <EmptyState title="No commission records yet" message="A commission appears here after the admin marks an eligible lead as completed." /> : <View style={styles.leadsList}>{commissionsList.map((commission) => <View key={commission.id} style={styles.leadCard}>

                        <View style={styles.leadTopRow}><Text style={styles.leadCode}>{commission.lead_code || `Lead #${commission.lead_id}`}</Text><View style={[styles.statusPill, commissionStatusStyle(commission.status)]}><Text style={styles.statusText}>{commission.status === 'paid' ? 'Disbursed' : formatStatus(commission.status)}</Text></View></View>

                        <Text style={styles.leadCustomer}>{commission.customer_name}</Text><Text style={styles.leadService}>{commission.service_name || 'Service not specified'}</Text>

                        <DetailRow label="Commission amount" value={formatMoney(commission.commission_amount)} /><DetailRow label="Commission rate" value={`${Number(commission.commission_percentage) || 0}%`} /><Text style={styles.leadDate}>Recorded {formatDate(commission.created_at)}</Text>

                        <Pressable onPress={() => void openLead(commission.lead_id)}><Text style={styles.cardAction}>View related lead  ›</Text></Pressable>

                    </View>)}</View>}

                </> : null}

                {view === 'profile' ? <>
                    {pageHeader('My Profile', 'Your saved personal details and payout preference.')}
                    {profileLoading ? <Loader label="Loading profile…" /> : <View style={styles.formCard}>
                        <FieldLabel text="Full name" /><TextInput value={profile.fullName} onChangeText={v => setProfile(p => ({ ...p, fullName: v }))} placeholder="Full name" placeholderTextColor="#94A3B8" style={styles.input} />
                        <FieldLabel text="Registered email (cannot be changed here)" /><TextInput value={user.email} editable={false} style={[styles.input, { backgroundColor: '#F1F5F3' }]} />
                        <FieldLabel text="Phone number" /><TextInput value={profile.phone} onChangeText={v => setProfile(p => ({ ...p, phone: v }))} keyboardType="phone-pad" placeholder="Phone number" placeholderTextColor="#94A3B8" style={styles.input} />
                        <FieldLabel text="Gender" /><View style={styles.filterRow}>{(['male', 'female', 'other', 'prefer_not_to_say'] as const).map(g => <Pressable key={g} onPress={() => setProfile(p => ({ ...p, gender: g }))} style={[styles.filterChip, profile.gender === g && styles.filterChipActive]}><Text style={[styles.filterChipText, profile.gender === g && styles.filterChipTextActive]}>{formatStatus(g)}</Text></Pressable>)}</View>
                        <FieldLabel text="Date of birth (YYYY-MM-DD)" /><TextInput value={profile.dateOfBirth} onChangeText={v => setProfile(p => ({ ...p, dateOfBirth: v }))} placeholder="YYYY-MM-DD" placeholderTextColor="#94A3B8" style={styles.input} />
                        <FieldLabel text="Address" /><TextInput value={profile.address} onChangeText={v => setProfile(p => ({ ...p, address: v }))} placeholder="Enter your address" placeholderTextColor="#94A3B8" multiline style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} />
                        <FieldLabel text="Payout method" /><View style={styles.filterRow}>{(['upi', 'bank'] as const).map(method => <Pressable key={method} onPress={() => setProfile(p => ({ ...p, payoutMethod: method }))} style={[styles.filterChip, profile.payoutMethod === method && styles.filterChipActive]}><Text style={[styles.filterChipText, profile.payoutMethod === method && styles.filterChipTextActive]}>{method === 'upi' ? 'UPI' : 'Bank account'}</Text></Pressable>)}</View>
                        {profile.payoutMethod === 'upi' ? <><FieldLabel text="UPI ID" /><TextInput value={profile.upiId} onChangeText={v => setProfile(p => ({ ...p, upiId: v }))} placeholder="name@bank" placeholderTextColor="#94A3B8" autoCapitalize="none" style={styles.input} /></> : <>
                            <FieldLabel text="Account holder name" /><TextInput value={profile.accountHolderName} onChangeText={v => setProfile(p => ({ ...p, accountHolderName: v }))} placeholder="Name on bank account" placeholderTextColor="#94A3B8" style={styles.input} />
                            <FieldLabel text="Bank name" /><TextInput value={profile.bankName} onChangeText={v => setProfile(p => ({ ...p, bankName: v }))} placeholder="Bank name" placeholderTextColor="#94A3B8" style={styles.input} />
                            <FieldLabel text="Account number" /><TextInput value={profile.accountNumber} onChangeText={v => setProfile(p => ({ ...p, accountNumber: v }))} placeholder="Account number" placeholderTextColor="#94A3B8" keyboardType="number-pad" style={styles.input} />
                            <FieldLabel text="IFSC code" /><TextInput value={profile.ifscCode} onChangeText={v => setProfile(p => ({ ...p, ifscCode: v.toUpperCase() }))} placeholder="ABCD0123456" placeholderTextColor="#94A3B8" autoCapitalize="characters" style={styles.input} />
                        </>}
                        {profileError ? <Text style={styles.formError}>{profileError}</Text> : null}{profileMessage ? <Text style={styles.formSuccess}>{profileMessage}</Text> : null}
                        <Text style={styles.formHint}>Enter valid payout details so Heaven Gate can use this account for eligible commission payments. Your registered email remains unchanged.</Text>
                        <Pressable style={[styles.button, profileSaving && styles.disabledButton]} disabled={profileSaving} onPress={() => void saveProfile()}>{profileSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Save Profile</Text>}</Pressable>
                    </View>}
                </> : null}
            </ScrollView>

        </KeyboardAvoidingView>

    );

}



function StatCard({ label, value, accent, onPress }: { label: string; value: number; accent: 'green' | 'blue' | 'gold' | 'red'; onPress: () => void }) {

    const accentStyle = { green: styles.accentGreen, blue: styles.accentBlue, gold: styles.accentGold, red: styles.accentRed }[accent];

    return <Pressable accessibilityRole="button" accessibilityLabel={`View ${label}`} onPress={onPress} style={({ pressed }) => [styles.statCard, pressed && styles.pressedCard]}>

        <View style={[styles.statAccent, accentStyle]} /><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{Number(value) || 0}</Text><Text style={styles.cardAction}>View leads  ›</Text>

    </Pressable>;

}

function MoneyStat({ label, amount, count }: { label: string; amount: number; count: number }) {

    return <View style={styles.moneyStat}><Text style={styles.moneyStatLabel}>{label}</Text><Text style={styles.moneyStatAmount}>{formatMoney(amount)}</Text><Text style={styles.moneyStatCount}>{count} record{count === 1 ? '' : 's'}</Text></View>;

}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {

    return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value === null || value === undefined || value === '' ? '—' : String(value)}</Text></View>;

}

function MiniStat({ label, value }: { label: string; value: number }) {

    return <View style={styles.miniStat}><Text style={styles.miniStatValue}>{Number(value) || 0}</Text><Text style={styles.miniStatLabel}>{label}</Text></View>;

}

function FieldLabel({ text }: { text: string }) { return <Text style={styles.fieldLabel}>{text}</Text>; }

function Loader({ label }: { label: string }) { return <View style={styles.loaderBox}><ActivityIndicator color="#174D48" /><Text style={styles.muted}>{label}</Text></View>; }

function EmptyState({ title, message }: { title: string; message: string }) { return <View style={styles.emptyCard}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.muted}>{message}</Text></View>; }

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) { return <View style={styles.warningBox}><Text style={styles.warningText}>{message}</Text><Pressable onPress={onRetry}><Text style={styles.warningAction}>Try again</Text></Pressable></View>; }



const styles = StyleSheet.create({

    screen: { flex: 1, backgroundColor: '#F4F7F5' }, scroll: { flex: 1 },

    container: { padding: 20, paddingTop: 54, paddingBottom: 38, gap: 18 },

    center: { flex: 1, backgroundColor: '#F4F7F5', padding: 26, justifyContent: 'center', alignItems: 'center', gap: 14 },

    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

    brandBlock: { flexDirection: 'row', alignItems: 'center', gap: 11 }, logo: { width: 48, height: 48, borderRadius: 15, backgroundColor: '#174D48', alignItems: 'center', justifyContent: 'center' }, logoText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },

    brandCopy: { gap: 3 }, brand: { color: '#17324D', fontSize: 12, fontWeight: '900', letterSpacing: 2 }, eyebrow: { color: '#718096', fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },

    refreshButton: { borderWidth: 1, borderColor: '#D7E2DD', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 13, backgroundColor: '#FFFFFF' }, refreshText: { color: '#174D48', fontSize: 12, fontWeight: '800' },

    greetingBlock: { gap: 8, marginTop: 10 }, homeTitle: { color: '#17324D', fontSize: 27, fontWeight: '900' }, title: { color: '#17324D', fontSize: 25, fontWeight: '900', textAlign: 'center' }, muted: { color: '#718096', fontSize: 13, lineHeight: 20, textAlign: 'left' },

    pageHeader: { gap: 8, marginBottom: 3 }, pageTitle: { color: '#17324D', fontSize: 26, fontWeight: '900' }, backButton: { alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#EAF1ED' }, backButtonInline: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 11 }, backButtonText: { color: '#174D48', fontSize: 12, fontWeight: '900' },

    sectionHeadingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }, sectionTitle: { color: '#17324D', fontSize: 17, fontWeight: '900' }, sectionHint: { color: '#718096', fontSize: 10, fontWeight: '700' }, inlineAction: { color: '#174D48', fontSize: 11, fontWeight: '900' },

    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, statCard: { width: '48%', minHeight: 115, flexGrow: 1, backgroundColor: '#FFFFFF', borderRadius: 17, borderWidth: 1, borderColor: '#E1E9E5', padding: 14, overflow: 'hidden' }, statAccent: { width: 30, height: 4, borderRadius: 3, marginBottom: 12 }, accentGreen: { backgroundColor: '#2C8068' }, accentBlue: { backgroundColor: '#4A79B8' }, accentGold: { backgroundColor: '#D49A34' }, accentRed: { backgroundColor: '#C45B5B' }, statLabel: { color: '#718096', fontSize: 12, fontWeight: '700' }, statValue: { color: '#17324D', fontSize: 27, fontWeight: '900', marginTop: 3 },

    moneyCard: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E1E9E5', padding: 17, gap: 3 }, moneyLabel: { color: '#718096', fontSize: 12, fontWeight: '700' }, moneyValue: { color: '#174D48', fontSize: 28, fontWeight: '900', marginTop: 5 }, moneyDivider: { height: 1, backgroundColor: '#E8EEEA', marginVertical: 15 }, moneyRow: { flexDirection: 'row', gap: 10 }, moneyStat: { flex: 1, gap: 5 }, moneyStatLabel: { color: '#718096', fontSize: 11, fontWeight: '700' }, moneyStatAmount: { color: '#17324D', fontSize: 12, fontWeight: '900' }, moneyStatCount: { color: '#94A3B8', fontSize: 10 }, rejectedNote: { color: '#A04444', fontSize: 11, marginTop: 13 },

    associateCard: { backgroundColor: '#EAF3EF', borderRadius: 17, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#D8E8E1' }, associateIcon: { width: 40, height: 40, backgroundColor: '#D5E8E0', borderRadius: 13, justifyContent: 'center', alignItems: 'center' }, associateIconText: { color: '#174D48', fontWeight: '900', fontSize: 12 }, associateCopy: { flex: 1, gap: 4 }, associateTitle: { color: '#174D48', fontWeight: '900', fontSize: 13 }, associateDescription: { color: '#55756D', fontSize: 11, lineHeight: 16 }, associateRight: { alignItems: 'flex-end', gap: 3 }, associateCount: { color: '#174D48', fontSize: 22, fontWeight: '900' },

    leadsList: { gap: 10 }, leadCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E1E9E5', padding: 14, gap: 7 }, pressedCard: { opacity: 0.78, borderColor: '#9FBFB2' }, leadTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, leadCode: { color: '#174D48', fontSize: 11, fontWeight: '900' }, statusPill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20 }, statusText: { fontSize: 10, fontWeight: '800', color: '#334155', textTransform: 'capitalize' }, statusCompleted: { backgroundColor: '#D9F1E5' }, statusCancelled: { backgroundColor: '#FBE3E3' }, statusConfirmed: { backgroundColor: '#DDEAFE' }, statusProgress: { backgroundColor: '#FFF0D2' }, statusNew: { backgroundColor: '#E7ECEA' }, leadCustomer: { color: '#17324D', fontSize: 15, fontWeight: '900' }, leadService: { color: '#718096', fontSize: 12 }, submittedBy: { color: '#55756D', fontSize: 11, fontWeight: '700' }, leadDate: { color: '#94A3B8', fontSize: 10, marginTop: 2 }, cardAction: { color: '#174D48', fontSize: 11, fontWeight: '900', marginTop: 4 },

    emptyCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E1E9E5', padding: 20, alignItems: 'center', gap: 8 }, emptyTitle: { color: '#17324D', fontWeight: '900', fontSize: 15, textAlign: 'center' }, noticeBox: { borderRadius: 15, borderWidth: 1, borderColor: '#D9E6E0', padding: 14, backgroundColor: '#EEF5F1', gap: 7 }, noticeTitle: { color: '#174D48', fontSize: 12, fontWeight: '900' }, noticeText: { color: '#55756D', fontSize: 11, lineHeight: 17 },

    accountCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E1E9E5', padding: 16, gap: 6 }, accountLabel: { color: '#94A3B8', fontSize: 10, letterSpacing: 1.2, fontWeight: '900' }, accountName: { color: '#17324D', fontSize: 16, fontWeight: '900', marginTop: 4 }, accountEmail: { color: '#718096', fontSize: 12 }, roleBadge: { color: '#174D48', fontWeight: '800', fontSize: 10, textTransform: 'capitalize', marginTop: 5 },

    button: { minHeight: 50, backgroundColor: '#174D48', borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 13 }, buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' }, outlineButton: { minHeight: 44, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#174D48', borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, marginTop: 7 }, outlineButtonText: { color: '#174D48', fontSize: 12, fontWeight: '900' }, disabledButton: { opacity: 0.55 },

    logoutLink: { padding: 12 }, linkText: { color: '#174D48', fontWeight: '900' }, warningBox: { borderRadius: 12, borderWidth: 1, borderColor: '#F1D1A0', backgroundColor: '#FFF8E9', padding: 12, gap: 8 }, warningText: { color: '#8A5B16', fontSize: 12 }, warningAction: { color: '#8A5B16', fontWeight: '900', fontSize: 12 }, footerText: { color: '#94A3B8', fontSize: 10, textAlign: 'center', marginTop: 4 },

    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, filterChip: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D7E2DD', borderRadius: 18, paddingVertical: 9, paddingHorizontal: 12 }, filterChipActive: { backgroundColor: '#174D48', borderColor: '#174D48' }, filterChipText: { color: '#55756D', fontSize: 11, fontWeight: '800' }, filterChipTextActive: { color: '#FFFFFF' },

    detailCard: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E1E9E5', padding: 16, gap: 13 }, detailCustomer: { color: '#17324D', fontSize: 22, fontWeight: '900', marginTop: 4 }, detailRow: { gap: 4, borderBottomWidth: 1, borderBottomColor: '#EEF2F0', paddingBottom: 9 }, detailLabel: { color: '#718096', fontSize: 11, fontWeight: '800' }, detailValue: { color: '#17324D', fontSize: 13, lineHeight: 19 }, notesBlock: { gap: 6, backgroundColor: '#F4F7F5', borderRadius: 11, padding: 11 }, historyCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E9E5', borderRadius: 13, padding: 13, gap: 7 }, historyStatus: { color: '#17324D', fontWeight: '900', fontSize: 12 },

    associateListCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E9E5', borderRadius: 17, padding: 14, gap: 13 }, associateListHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, associateName: { color: '#17324D', fontSize: 15, fontWeight: '900' }, avatar: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#E3F0EA', alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#174D48', fontSize: 13, fontWeight: '900' }, miniStatsRow: { flexDirection: 'row', gap: 6, justifyContent: 'space-between', marginTop: 6 }, miniStat: { flex: 1, backgroundColor: '#F4F7F5', borderRadius: 10, padding: 8, alignItems: 'center', gap: 4 }, miniStatValue: { color: '#17324D', fontSize: 16, fontWeight: '900' }, miniStatLabel: { color: '#718096', fontSize: 9, textAlign: 'center', fontWeight: '700' },

    formCard: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E1E9E5', padding: 16, gap: 8 }, fieldLabel: { color: '#17324D', fontSize: 12, fontWeight: '900', marginTop: 7 }, input: { borderWidth: 1, borderColor: '#D9E3DE', borderRadius: 12, minHeight: 48, paddingHorizontal: 13, paddingVertical: 10, fontSize: 14, color: '#17324D', backgroundColor: '#FFFFFF' }, formError: { color: '#B42318', fontSize: 12, lineHeight: 18, marginTop: 6 }, formSuccess: { color: '#176B45', fontSize: 12, lineHeight: 18, marginTop: 6 }, formHint: { color: '#718096', fontSize: 11, lineHeight: 17, marginTop: 5 }, loaderBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 30, gap: 12 },

});
