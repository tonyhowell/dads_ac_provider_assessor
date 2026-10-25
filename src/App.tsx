import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Placeholder } from './screens/Placeholder';
import { ProvidersScreen } from './screens/ProvidersScreen';
import { ProviderDetailScreen } from './screens/ProviderDetailScreen';
import { SelectionScreen } from './screens/SelectionScreen';
import { InterviewsScreen } from './screens/InterviewsScreen';
import { InterviewCaptureScreen } from './screens/InterviewCaptureScreen';
import { InterviewReviewScreen } from './screens/InterviewReviewScreen';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={
            <Placeholder
              title="Participant setup"
              phase="Phase 3.1"
              description="Suburb, pension status, DVA card, classification and contributions paid, with derived contribution rates and DVA prompts."
            />
          }
        />
        <Route
          path="overview"
          element={<Placeholder title="Overview" phase="Phase 3.2" description="Key program rules, budget for the selected classification and the contribution table." />}
        />
        <Route
          path="costs"
          element={<Placeholder title="Relative costs" phase="Phase 3.3" description="Care plan editor, cost per provider against the services budget, out-of-pocket and variance tables." />}
        />
        <Route path="providers" element={<ProvidersScreen />} />
        <Route path="providers/:id" element={<ProviderDetailScreen />} />
        <Route path="selection" element={<Navigate to="/selection/scan" replace />} />
        <Route path="selection/:stage" element={<SelectionScreen />} />
        <Route path="shortlist" element={<Navigate to="/selection/interview" replace />} />
        <Route
          path="bounding"
          element={<Placeholder title="Bounding questions" phase="Phase 3.6" description="Eight groups of questions that decide which interview sections apply." />}
        />
        <Route
          path="interview-pack"
          element={<Placeholder title="Interview pack" phase="Phase 3.7" description="Filtered interview questions with a response column per shortlisted provider, and print export." />}
        />
        <Route path="interviews" element={<InterviewsScreen />} />
        <Route path="interviews/new/:providerId" element={<InterviewCaptureScreen />} />
        <Route path="interviews/:id" element={<InterviewReviewScreen />} />
        <Route
          path="scoring"
          element={<Placeholder title="Scoring & decision" phase="Phase 3.8" description="Score interviewed providers on weighted criteria and record the decision." />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
