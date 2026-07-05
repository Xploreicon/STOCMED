import React, { useState, useRef } from 'react';
import { FileText, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/useUser';
import { toast } from 'sonner';

interface SymptomIntakeFormProps {
  threadId: string;
  onSuccess: (intakeId: string) => void;
  onCancel: () => void;
}

export default function SymptomIntakeForm({
  threadId,
  onSuccess,
  onCancel,
}: SymptomIntakeFormProps) {
  const { user } = useUser();
  const [symptoms, setSymptoms] = useState('');
  const [duration, setDuration] = useState('');
  const [severity, setSeverity] = useState<'mild' | 'moderate' | 'severe'>('mild');
  const [age, setAge] = useState('');
  const [pregnancyBreastfeeding, setPregnancyBreastfeeding] = useState(false);
  const [currentMedications, setCurrentMedications] = useState('');
  const [allergies, setAllergies] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.size > 5 * 1024 * 1024) {
        toast.error('File size is too large. Max is 5MB.');
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error('You must be logged in to submit a symptom intake form.');
      return;
    }

    if (!symptoms.trim() || !duration.trim() || !age.trim()) {
      toast.error('Please fill in all required fields.');
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();

    try {
      let photoUrl = null;

      // 1. Upload photo if selected
      if (file) {
        const timestamp = Date.now();
        const fileExt = file.name.split('.').pop();
        const filePath = `${user.id}/intake_${timestamp}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('prescriptions') // Use private prescriptions bucket for medical files
          .upload(filePath, file);

        if (uploadError) throw uploadError;
        photoUrl = filePath;
      }

      // 2. Compute 4-hour SLA deadline
      const slaDeadline = new Date();
      slaDeadline.setHours(slaDeadline.getHours() + 4);

      // 3. Save intake record
      const { data, error: dbError } = await (supabase.from('symptom_intakes') as any)
        .insert({
          user_id: user.id,
          thread_id: threadId,
          symptoms,
          duration,
          severity,
          age,
          pregnancy_breastfeeding: pregnancyBreastfeeding,
          current_medications: currentMedications || null,
          allergies: allergies || null,
          photo_url: photoUrl,
          status: 'submitted',
          sla_deadline: slaDeadline.toISOString(),
        })
        .select('id')
        .single();

      if (dbError) throw dbError;

      toast.success('Symptom details sent to our duty pharmacist.');
      onSuccess(data.id);
    } catch (err: any) {
      console.error('Failed to submit symptom intake:', err);
      toast.error(err.message || 'Intake submission failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full bg-white border border-slate-200 rounded-2xl p-5 shadow-lg max-w-lg mx-auto">
      <div className="flex items-center space-x-2.5 mb-4 border-b border-slate-100 pb-3">
        <FileText className="w-5 h-5 text-blue-600" />
        <div>
          <h3 className="text-sm font-bold text-slate-900">Pharmacist Symptom Intake</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Fill this out to queue for review by a licensed duty pharmacist.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 text-left">
        {/* Symptoms */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
            Describe symptoms *
          </label>
          <textarea
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            placeholder="e.g. Cough, runny nose, slight throat irritation..."
            className="w-full mt-1.5 p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:bg-white focus:outline-none transition-all resize-none h-20"
            required
          />
        </div>

        {/* Duration & Age */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
              Duration *
            </label>
            <input
              type="text"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="e.g. 3 days"
              className="w-full mt-1.5 p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
              Patient Age *
            </label>
            <input
              type="text"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="e.g. 28 years"
              className="w-full mt-1.5 p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
              required
            />
          </div>
        </div>

        {/* Severity & Pregnancy */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
              Severity *
            </label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as any)}
              className="w-full mt-1.5 p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
            >
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </select>
          </div>
          <div className="flex items-center space-x-2.5 pt-7 pl-1">
            <input
              type="checkbox"
              id="preg-breast"
              checked={pregnancyBreastfeeding}
              onChange={(e) => setPregnancyBreastfeeding(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="preg-breast" className="text-xs font-semibold text-slate-700 cursor-pointer">
              Pregnancy / Breastfeeding?
            </label>
          </div>
        </div>

        {/* Medications & Allergies */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
              Current Meds
            </label>
            <input
              type="text"
              value={currentMedications}
              onChange={(e) => setCurrentMedications(e.target.value)}
              placeholder="e.g. None or Vitamin C"
              className="w-full mt-1.5 p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
              Drug Allergies
            </label>
            <input
              type="text"
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
              placeholder="e.g. Penicillin"
              className="w-full mt-1.5 p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
            />
          </div>
        </div>

        {/* Photo Upload (Optional) */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
            Attach photo (Optional)
          </label>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            accept=".jpg,.jpeg,.png,.webp"
          />
          <div className="flex items-center space-x-2 mt-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors"
            >
              Choose photo
            </button>
            <span className="text-xs text-slate-500">
              {file ? file.name : 'No file selected (Max 5MB)'}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 py-3 text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl border border-slate-200 transition-colors"
          >
            Cancel
          </button>
          
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-xl flex items-center justify-center space-x-2 transition-all shadow-md"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Submitting...</span>
              </>
            ) : (
              <span>Submit to Duty RPh</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
