import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { emptyProfile } from '../state/reducer';
import { COMMUNICATION_NEEDS, DVA_CONDITIONS, DVA_SERVICES } from '../schemas';
import type { ApplicantProfile } from '../types';
import { CheckCards, Field } from './ui/Form';
import { Icon } from './ui/Icon';

type TextKey = { [K in keyof ApplicantProfile]: ApplicantProfile[K] extends string ? K : never }[keyof ApplicantProfile];

/**
 * What providers should know about the applicant: how to address them, who to contact, communication
 * needs, DVA details and current supports. Saves as you go. Nothing here is shared until the family
 * prints a dossier and chooses which sections go in it. No DVA file or card numbers are asked for.
 */
export function ProfileEditor() {
  const { state, dispatch, canEdit } = useApp();
  const profile = state.profile ?? emptyProfile();
  const card = state.participant?.dva_card ?? 'none';
  const save = (patch: Partial<ApplicantProfile>) => dispatch({ type: 'profile/update', patch });

  return (
    <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
      <legend className="sr-only">For providers</legend>
      <div className="space-y-1">
        <h2 className="flex items-center gap-2">
          <Icon name="users" size={26} /> For providers
        </h2>
        <p>What a provider should know before meeting you. It saves as you go, and goes in a dossier only if you choose when printing it.</p>
      </div>

      <section className="card space-y-4" aria-labelledby="pf-know">
        <h3 id="pf-know">How to address you, and who to contact</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField k="preferred_name" label="Preferred name" hint='What you like to be called, e.g. "Bill".' profile={profile} save={save} />
          <TextField k="languages" label="Languages" hint="If not English, or as well as English." profile={profile} save={save} />
          <TextField k="contact_name" label="Contact person for providers" hint="Often the family member arranging care. Leave blank if it's you." profile={profile} save={save} />
          <TextField k="contact_relationship" label="Their relationship to you" profile={profile} save={save} />
          <TextField k="contact_phone" label="Their phone" type="tel" profile={profile} save={save} />
          <TextField k="contact_email" label="Their email" type="email" profile={profile} save={save} />
        </div>
        <CheckCards
          legend="Communication needs"
          value={profile.communication}
          onChange={(v) => save({ communication: v })}
          choices={COMMUNICATION_NEEDS.map(([value, label]) => ({ value, label }))}
        />
        <TextField k="communication_other" label="Anything else about communicating with you" multiline profile={profile} save={save} />
      </section>

      {card !== 'none' && (
        <section className="card space-y-4" aria-labelledby="pf-dva">
          <h3 id="pf-dva" className="flex items-center gap-2">
            <Icon name="card" size={24} /> DVA details
          </h3>
          <p>
            {card === 'gold' ? 'Gold Card' : 'White Card'} holder. We don't ask for DVA file or card numbers; give those to the provider directly when you sign up.
          </p>
          <CheckCards
            legend={card === 'white' ? 'Accepted conditions (what your White Card covers)' : 'Accepted conditions'}
            hint="Providers use this to plan care and to work out what DVA could fund."
            value={profile.dva_conditions}
            onChange={(v) => save({ dva_conditions: v })}
            choices={DVA_CONDITIONS.map(([value, label]) => ({ value, label }))}
          />
          <TextField k="dva_conditions_other" label="Other accepted conditions" multiline profile={profile} save={save} />
          <CheckCards
            legend="DVA services you receive now"
            value={profile.dva_services}
            onChange={(v) => save({ dva_services: v })}
            choices={DVA_SERVICES.map(([value, label]) => ({ value, label }))}
          />
          <TextField k="dva_services_detail" label="Details of those services" hint="For example hours a fortnight, and who provides them." multiline profile={profile} save={save} />
        </section>
      )}

      <section className="card space-y-4" aria-labelledby="pf-more">
        <h3 id="pf-more">Your current supports, and anything else</h3>
        <TextField k="current_supports" label="Help you have now" hint="Family, neighbours, other services, equipment." multiline profile={profile} save={save} />
        <TextField k="anything_else" label="Anything else a provider should know" multiline profile={profile} save={save} />
      </section>
    </fieldset>
  );
}

/** A text field that saves when you leave it, and picks up changes others make while you're not editing. */
function TextField({
  k,
  label,
  hint,
  type = 'text',
  multiline = false,
  profile,
  save,
}: {
  k: TextKey;
  label: string;
  hint?: string;
  type?: string;
  multiline?: boolean;
  profile: ApplicantProfile;
  save: (patch: Partial<ApplicantProfile>) => void;
}) {
  const [draft, setDraft] = useState(profile[k]);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(profile[k]);
  }, [profile, k, editing]);
  const commit = () => {
    setEditing(false);
    if (draft !== profile[k]) save({ [k]: draft.trim() } as Partial<ApplicantProfile>);
  };
  return (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) =>
        multiline ? (
          <textarea id={id} aria-describedby={describedBy} className="input min-h-20" value={draft} onFocus={() => setEditing(true)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
        ) : (
          <input id={id} aria-describedby={describedBy} type={type} className="input" value={draft} onFocus={() => setEditing(true)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
        )
      }
    </Field>
  );
}
