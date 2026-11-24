import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import {
  selectOptionLabel,
  selectOptionValue,
  validateUserInputs,
  type PublicScenario,
  type UserInputField,
  type UserInputValues,
} from '@rehearsal/shared';
import { Button, PageShell, Select, Textarea, TextInput } from '../../components';
import { ScenarioLoadStates } from './ScenarioLoadStates';
import { useAuth } from '../../auth/authContext';
import { cleanSetupValues, initialSetupValues, readSetupValues, writeSetupValues } from './setupValues';
import { useScenario } from './useScenario';
import styles from './scenario.module.css';

interface SetupFieldProps {
  field: UserInputField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

function SetupField({ field, value, error, onChange }: SetupFieldProps) {
  const common = {
    label: field.label,
    error,
    name: field.key,
    required: field.required,
    labelAside: field.required ? undefined : 'Optional',
  };
  if (field.type === 'select') {
    return (
      <Select
        {...common}
        value={value}
        placeholder="Choose one"
        options={field.options.map((o) => ({ value: selectOptionValue(o), label: selectOptionLabel(o) }))}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  const Control = field.type === 'textarea' ? Textarea : TextInput;
  return (
    <Control
      {...common}
      value={value}
      placeholder={field.placeholder}
      maxLength={field.maxLength}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
    />
  );
}

interface SetupFormProps {
  scenario: PublicScenario;
}

function SetupForm({ scenario }: SetupFormProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [values, setValues] = useState<UserInputValues>(() =>
    initialSetupValues(scenario.userInputs, readSetupValues(scenario.id), user?.profile?.field),
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validateUserInputs(scenario.userInputs, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    writeSetupValues(scenario.id, cleanSetupValues(scenario.userInputs, values));
    navigate(`/scenarios/${scenario.id}/brief`);
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {scenario.userInputs.map((field) => (
        <SetupField
          key={field.key}
          field={field}
          value={values[field.key] ?? ''}
          error={errors[field.key]}
          onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
        />
      ))}
      <div className={styles.actions}>
        <Button type="submit" size="lg" icon={ArrowRight} iconPosition="end">
          Continue
        </Button>
      </div>
    </form>
  );
}

export function ScenarioSetupScreen() {
  const { scenarioId = '' } = useParams();
  const { load, reload } = useScenario(scenarioId);

  if (load.status === 'ready' && load.data.scenario.userInputs.length === 0) {
    return <Navigate to={`/scenarios/${scenarioId}/brief`} replace />;
  }

  return (
    <PageShell
      title="Set the scene"
      eyebrow={load.status === 'ready' ? load.data.scenario.title : undefined}
      lead="A detail or two so the conversation fits you."
      header="minimal"
    >
      {load.status === 'ready' ? (
        <SetupForm scenario={load.data.scenario} />
      ) : (
        <ScenarioLoadStates load={load} onRetry={reload} />
      )}
    </PageShell>
  );
}
