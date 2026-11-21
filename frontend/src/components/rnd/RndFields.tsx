import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { RndFormData } from '../../types';
import { rndGroups, rndSections } from '../../utils/rndFields';
import { EditorInput, EditorTextarea, ActionButton, FormField } from '../create/RequestEditorControls';

export function RndFields({
  value,
  onChange,
  evaluation = false,
  disabled = false,
}: {
  value: RndFormData;
  onChange: (value: RndFormData) => void;
  evaluation?: boolean;
  disabled?: boolean;
}) {
  const prefix = useId();
  const update = (id: string, text: string) => onChange({ ...value, fields: { ...value.fields, [id]: text } });

  return (
    <div className="space-y-6">
      {rndSections
        .filter((section) => (section.id === 'H') === evaluation)
        .map((section) => (
          <fieldset
            key={section.id}
            disabled={disabled}
            className="min-w-0 space-y-4 border-t border-slate-200 pt-4"
          >
            <legend className="px-1 text-sm font-bold text-workspace-ink">
              {section.title}
            </legend>
            {section.items.map((item) => {
              if (item.kind === 'text') {
                const automatic = ['inpCompany', 'inpGSubBy', 'inpGDate'].includes(item.id);
                return (
                  <FormField
                    key={item.id}
                    id={`${prefix}-${item.id}`}
                    label={item.label}
                    hint={
                      item.id === 'inpGSigText'
                        ? 'Your saved, uploaded or drawn signature is captured when you sign & send.'
                        : undefined
                    }
                  >
                    {item.multiline ? (
                      <EditorTextarea
                        id={`${prefix}-${item.id}`}
                        rows={3}
                        maxLength={2000}
                        value={value.fields[item.id] ?? ''}
                        onChange={(e) => update(item.id, e.target.value)}
                      />
                    ) : (
                      <EditorInput
                        id={`${prefix}-${item.id}`}
                        maxLength={2000}
                        readOnly={automatic}
                        value={value.fields[item.id] ?? ''}
                        onChange={(e) => update(item.id, e.target.value)}
                      />
                    )}
                  </FormField>
                );
              }

              if (item.kind === 'market') {
                return (
                  <fieldset key={item.id} className="min-w-0 space-y-3">
                    <legend className="text-sm font-semibold text-workspace-ink">Market solutions</legend>
                    {value.marketRows.map((row, index) => (
                      <div
                        key={index}
                        className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3.5"
                      >
                        <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                          <p className="text-xs font-bold uppercase tracking-wider text-slate-700">
                            Solution {index + 1}
                          </p>
                          <ActionButton
                            variant="quiet"
                            size="sm"
                            icon={Trash2}
                            className="text-rose-700 hover:bg-rose-50"
                            onClick={() =>
                              onChange({
                                ...value,
                                marketRows: value.marketRows.filter((_, i) => i !== index),
                              })
                            }
                          >
                            Remove
                          </ActionButton>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {(['sol', 'sup', 'web'] as const).map((key, i) => (
                            <FormField
                              key={key}
                              label={['Solution / Product', 'Supplier / Company', 'Website / Reference'][i]}
                            >
                              <EditorInput
                                maxLength={300}
                                placeholder={['Product name', 'Vendor / Company', 'URL or contact'][i]}
                                value={row[key]}
                                onChange={(e) =>
                                  onChange({
                                    ...value,
                                    marketRows: value.marketRows.map((r, n) =>
                                      n === index ? { ...r, [key]: e.target.value } : r
                                    ),
                                  })
                                }
                              />
                            </FormField>
                          ))}
                        </div>
                      </div>
                    ))}
                    <ActionButton
                      variant="secondary"
                      size="sm"
                      icon={Plus}
                      disabled={value.marketRows.length >= 5}
                      onClick={() =>
                        onChange({
                          ...value,
                          marketRows: [...value.marketRows, { sol: '', sup: '', web: '' }],
                        })
                      }
                    >
                      Add solution (up to 5)
                    </ActionButton>
                  </fieldset>
                );
              }

              const group = rndGroups.find((group) => group.id === item.id)!;
              return (
                <fieldset key={item.id} className="space-y-2">
                  <legend className="text-sm font-semibold text-workspace-ink">{item.label}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.options.map((option) => (
                      <label
                        key={option}
                        className="flex items-start gap-2.5 rounded-lg border border-slate-300 bg-slate-50/60 p-2.5 text-xs text-slate-800 transition-colors hover:bg-white hover:border-slate-400 has-checked:border-teal-700 has-checked:bg-teal-50/80 has-checked:text-teal-950 font-medium cursor-pointer"
                      >
                        <input
                          type={group.singleSelect ? 'radio' : 'checkbox'}
                          name={`${prefix}-${group.id}`}
                          className="mt-0.5 size-4 accent-teal-700"
                          checked={value.choices[group.id]?.includes(option) ?? false}
                          onChange={(e) =>
                            onChange({
                              ...value,
                              choices: {
                                ...value.choices,
                                [group.id]: group.singleSelect
                                  ? [option]
                                  : e.target.checked
                                  ? [...(value.choices[group.id] ?? []), option]
                                  : value.choices[group.id].filter((text) => text !== option),
                              },
                            })
                          }
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </fieldset>
        ))}
    </div>
  );
}
