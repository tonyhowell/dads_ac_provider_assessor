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
import type { StateSync } from './state/sync';
import type { AudioStore } from './storage/audioStore';

export function App({ seed, sync, audio }: { seed: SeedData; sync: StateSync; audio: AudioStore }) {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/enrol/:token" element={<EnrolScreen />} />
      <Route
        path="*"
        element={
          user ? (
            <AppProvider key={user.id} seed={seed} sync={sync} audio={audio}>
              <HelpProvider help={seed.help}>
                <SignedInRoutes isAdmin={user.role === 'admin'} />
              </HelpProvider>
            </AppProvider>
          ) : (
            <SignInScreen />
          )
        }
      />
    </Routes>
  );
}

function SignedInRoutes({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Routes>
      <Route path="interview-pack/print" element={<PrintPackScreen />} />
      <Route element={<Layout />}>
        <Route index element={<ParticipantScreen />} />
        <Route path="overview" element={<OverviewScreen />} />
        <Route path="costs" element={<CostsScreen />} />
        <Route path="providers" element={<ProvidersScreen />} />
        <Route path="providers/new" element={<ProviderFormScreen />} />
        <Route path="providers/import" element={<ProviderImportScreen />} />
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
        <Route path="about" element={<AboutScreen />} />
        {isAdmin && <Route path="admin" element={<AdminScreen />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
