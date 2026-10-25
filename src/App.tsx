import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ParticipantScreen } from './screens/ParticipantScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { CostsScreen } from './screens/CostsScreen';
import { ProviderFormScreen } from './screens/ProviderFormScreen';
import { ProviderImportScreen } from './screens/ProviderImportScreen';
import { BoundingScreen } from './screens/BoundingScreen';
import { InterviewPackScreen } from './screens/InterviewPackScreen';
import { ScoringScreen } from './screens/ScoringScreen';
import { PrintPackScreen } from './screens/PrintPackScreen';
import { SummaryScreen } from './screens/SummaryScreen';
import { ProvidersScreen } from './screens/ProvidersScreen';
import { ProviderDetailScreen } from './screens/ProviderDetailScreen';
import { SelectionScreen } from './screens/SelectionScreen';
import { InterviewsScreen } from './screens/InterviewsScreen';
import { InterviewCaptureScreen } from './screens/InterviewCaptureScreen';
import { InterviewReviewScreen } from './screens/InterviewReviewScreen';
import { SignInScreen } from './screens/SignInScreen';
import { EnrolScreen } from './screens/EnrolScreen';
import { AdminScreen } from './screens/AdminScreen';
import { useAuth } from './auth/AuthContext';
import { AppProvider } from './state/AppContext';
import { HelpProvider } from './components/ui/HelpPanel';
import { AboutScreen } from './screens/AboutScreen';
import type { SeedData } from './data/load';
import type { ApplicationInfo, Backend, MemberRole } from './backend';
import { SessionProvider, useSession } from './state/SessionContext';
import { PlainLayout } from './components/Shell';
import { ApplicationsScreen } from './screens/ApplicationsScreen';
import { PeopleScreen } from './screens/PeopleScreen';
import { AdminLayout, AdminApplicationsScreen, AdminSuggestionsScreen, AdminProvidersScreen } from './screens/admin';
import type { AudioStore } from './storage/audioStore';

export function App({ seed, backend, audio }: { seed: SeedData; backend: Backend; audio: AudioStore }) {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/enrol/:token" element={<EnrolScreen />} />
      <Route
        path="*"
        element={
          user ? (
            <SessionProvider key={user.id} backend={backend} seed={seed}>
              <HelpProvider help={seed.help}>
                <SignedIn isAdmin={user.role === 'admin'} audio={audio} />
              </HelpProvider>
            </SessionProvider>
          ) : (
            <SignInScreen />
          )
        }
      />
    </Routes>
  );
}

function SignedIn({ isAdmin, audio }: { isAdmin: boolean; audio: AudioStore }) {
  return (
    <Routes>
      <Route element={<PlainLayout />}>
        <Route path="applications" element={<ApplicationsScreen />} />
        <Route path="about" element={<AboutScreen />} />
        {isAdmin && (
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<AdminScreen />} />
            <Route path="applications" element={<AdminApplicationsScreen />} />
            <Route path="suggestions" element={<AdminSuggestionsScreen />} />
            <Route path="providers" element={<AdminProvidersScreen />} />
            <Route path="providers/new" element={<ProviderFormScreen />} />
            <Route path="providers/import" element={<ProviderImportScreen />} />
            <Route path="providers/:id/edit" element={<ProviderFormScreen />} />
          </Route>
        )}
      </Route>
      <Route path="*" element={<ApplicationGate audio={audio} />} />
    </Routes>
  );
}

/** Opens the current application, or sends the person to choose one. */
function ApplicationGate({ audio }: { audio: AudioStore }) {
  const { backend, applications, applicationsError, currentId } = useSession();
  const [opened, setOpened] = useState<{ application: ApplicationInfo; role: MemberRole } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!currentId) return;
    let live = true;
    setOpened(null);
    backend
      .getApplication(currentId)
      .then((r) => live && (setOpened(r), setError(null)))
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Could not open the application.'));
    return () => {
      live = false;
    };
  }, [backend, currentId]);
  const sync = useMemo(() => (currentId ? backend.sync(currentId) : null), [backend, currentId]);

  if (applicationsError) return <div className="p-6 text-center" role="alert">{applicationsError}</div>;
  if (!applications) return <div className="p-6 text-center" role="status">Loading your applications…</div>;
  if (!currentId) return <Navigate to="/applications" replace />;
  if (error) return <div className="p-6 text-center" role="alert">{error}</div>;
  if (!opened || opened.application.id !== currentId || !sync) return <div className="p-6 text-center" role="status">Opening the application…</div>;
  return (
    <AppProvider key={currentId} sync={sync} audio={audio} application={opened.application} role={opened.role}>
      <ApplicationRoutes />
    </AppProvider>
  );
}

function ApplicationRoutes() {
  return (
    <Routes>
      <Route path="interview-pack/print" element={<PrintPackScreen />} />
      <Route element={<Layout />}>
        <Route index element={<ParticipantScreen />} />
        <Route path="overview" element={<OverviewScreen />} />
        <Route path="costs" element={<CostsScreen />} />
        <Route path="providers" element={<ProvidersScreen />} />
        <Route path="providers/new" element={<ProviderFormScreen />} />
        <Route path="providers/:id" element={<ProviderDetailScreen />} />
        <Route path="providers/:id/edit" element={<ProviderFormScreen />} />
        <Route path="selection" element={<Navigate to="/selection/scan" replace />} />
        <Route path="selection/:stage" element={<SelectionScreen />} />
        <Route path="shortlist" element={<Navigate to="/selection/interview" replace />} />
        <Route path="bounding" element={<BoundingScreen />} />
        <Route path="interview-pack" element={<InterviewPackScreen />} />
        <Route path="interviews" element={<InterviewsScreen />} />
        <Route path="interviews/new/:providerId" element={<InterviewCaptureScreen />} />
        <Route path="interviews/:id" element={<InterviewReviewScreen />} />
        <Route path="scoring" element={<ScoringScreen />} />
        <Route path="summary" element={<SummaryScreen />} />
        <Route path="people" element={<PeopleScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
