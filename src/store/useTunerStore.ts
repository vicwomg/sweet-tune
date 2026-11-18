import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BUILTIN_PRESETS,
  createAllEnabledNotes,
  createZeroOffsets,
} from '../audio/temperaments';
import type { NoteName, StrobeStyle, TemperamentPreset } from '../types/tuner';

const STORAGE_KEYS = {
  customPresets: 'sweettune.customPresets.v1',
  pinnedIds: 'sweettune.pinnedIds.v1',
  activePresetId: 'sweettune.activePresetId.v1',
  rootNote: 'sweettune.rootNote.v1',
  a4Hz: 'sweettune.a4Hz.v1',
  strobeStyle: 'sweettune.strobeStyle.v1',
  presetFlats: 'sweettune.presetFlats.v1',
  noiseGate: 'sweettune.noiseGate.v1',
} as const;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function useTunerStore() {
  const [customPresets, setCustomPresets] = useState<TemperamentPreset[]>(() =>
    readJson<TemperamentPreset[]>(STORAGE_KEYS.customPresets, [])
  );

  const [pinnedIds, setPinnedIds] = useState<string[]>(() =>
    readJson<string[]>(
      STORAGE_KEYS.pinnedIds,
      BUILTIN_PRESETS.filter((p) => p.pinned).map((p) => p.id)
    )
  );

  const [activePresetId, setActivePresetId] = useState<string>(() =>
    localStorage.getItem(STORAGE_KEYS.activePresetId) || 'builtin-12tet'
  );

  const [rootNote, setRootNote] = useState<NoteName>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.rootNote);
    return (saved as NoteName) || 'C';
  });

  const [a4Hz, setA4Hz] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEYS.a4Hz));
    return Number.isFinite(saved) && saved >= 400 && saved <= 480 ? saved : 440;
  });

  const [strobeStyle, setStrobeStyle] = useState<StrobeStyle>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.strobeStyle);
    if (saved === 'horizontal' || saved === 'dial' || saved === 'bars') {
      return saved;
    }
    return 'circle';
  });

  const [presetFlatsMap, setPresetFlatsMap] = useState<Record<string, boolean>>(() =>
    readJson<Record<string, boolean>>(STORAGE_KEYS.presetFlats, {})
  );

  const [noiseGate, setNoiseGate] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEYS.noiseGate));
    return Number.isFinite(saved) && saved > 0 && saved < 0.1 ? saved : 0.009;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.customPresets, JSON.stringify(customPresets));
  }, [customPresets]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.pinnedIds, JSON.stringify(pinnedIds));
  }, [pinnedIds]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.activePresetId, activePresetId);
  }, [activePresetId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.rootNote, rootNote);
  }, [rootNote]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.a4Hz, String(a4Hz));
  }, [a4Hz]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.strobeStyle, strobeStyle);
  }, [strobeStyle]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.presetFlats, JSON.stringify(presetFlatsMap));
  }, [presetFlatsMap]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.noiseGate, String(noiseGate));
  }, [noiseGate]);

  const allPresets = useMemo<TemperamentPreset[]>(() => {
    const pinnedSet = new Set(pinnedIds);
    return [...customPresets, ...BUILTIN_PRESETS].map((p) => ({
      ...p,
      pinned: pinnedSet.has(p.id),
      preferFlats: presetFlatsMap[p.id] ?? p.preferFlats ?? false,
    }));
  }, [customPresets, pinnedIds, presetFlatsMap]);

  const quickPresets = useMemo<TemperamentPreset[]>(() => {
    const pinned = allPresets.filter((p) => p.pinned).slice(0, 10);
    const active = allPresets.find((p) => p.id === activePresetId);
    if (active && !active.pinned) {
      return [active, ...pinned.slice(0, 9)];
    }
    return pinned;
  }, [allPresets, activePresetId]);

  const activePreset = useMemo<TemperamentPreset>(
    () => allPresets.find((p) => p.id === activePresetId) ?? BUILTIN_PRESETS[0],
    [allPresets, activePresetId]
  );

  const useFlats = Boolean(activePreset.preferFlats);

  const toggleActivePresetFlats = useCallback(() => {
    setPresetFlatsMap((prev) => ({
      ...prev,
      [activePreset.id]: !activePreset.preferFlats,
    }));
  }, [activePreset.id, activePreset.preferFlats]);

  const selectPreset = useCallback(
    (id: string) => {
      const target = allPresets.find((p) => p.id === id);
      if (!target) return;
      setActivePresetId(id);
      if (target.isKeyDependent) {
        setRootNote(target.defaultRoot);
      }
    },
    [allPresets]
  );

  const saveCustomPreset = useCallback(
    (preset: Omit<TemperamentPreset, 'isBuiltIn' | 'id'> & { id?: string }) => {
      const id = preset.id || `custom-${Date.now()}`;
      const newPreset: TemperamentPreset = {
        ...preset,
        id,
        isBuiltIn: false,
        offsets: { ...createZeroOffsets(), ...preset.offsets },
        enabledNotes: preset.enabledNotes
          ? { ...createAllEnabledNotes(), ...preset.enabledNotes }
          : createAllEnabledNotes(),
      };

      setCustomPresets((prev) => {
        const exists = prev.some((p) => p.id === id);
        if (exists) {
          return prev.map((p) => (p.id === id ? newPreset : p));
        }
        return [newPreset, ...prev];
      });

      if (typeof preset.preferFlats === 'boolean') {
        setPresetFlatsMap((prev) => ({
          ...prev,
          [id]: Boolean(preset.preferFlats),
        }));
      }

      if (newPreset.pinned) {
        setPinnedIds((prev) =>
          prev.includes(id) ? prev : [id, ...prev].slice(0, 10)
        );
      }

      setActivePresetId(id);
      if (newPreset.isKeyDependent) {
        setRootNote(newPreset.defaultRoot);
      }
      return newPreset;
    },
    []
  );

  const deleteCustomPreset = useCallback(
    (id: string) => {
      setCustomPresets((prev) => prev.filter((p) => p.id !== id));
      setPinnedIds((prev) => prev.filter((pid) => pid !== id));
      if (activePresetId === id) {
        setActivePresetId('builtin-12tet');
      }
    },
    [activePresetId]
  );

  const togglePinPreset = useCallback((id: string) => {
    setPinnedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((pid) => pid !== id);
      }
      if (prev.length >= 10) {
        return prev;
      }
      return [...prev, id];
    });
  }, []);

  return {
    allPresets,
    quickPresets,
    activePreset,
    activePresetId,
    rootNote,
    setRootNote,
    a4Hz,
    setA4Hz,
    strobeStyle,
    setStrobeStyle,
    useFlats,
    toggleActivePresetFlats,
    noiseGate,
    setNoiseGate,
    selectPreset,
    saveCustomPreset,
    deleteCustomPreset,
    togglePinPreset,
  };
}
