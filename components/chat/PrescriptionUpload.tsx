import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/useUser';
import { toast } from 'sonner';

interface PrescriptionUploadProps {
  productName: string;
  threadId: string;
  onSuccess: (fileUrl: string) => void;
}

export default function PrescriptionUpload({
  productName,
  threadId,
  onSuccess,
}: PrescriptionUploadProps) {
  const { user } = useUser();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!validTypes.includes(selectedFile.type)) {
      toast.error('Invalid file type. Please upload a JPG, PNG, WEBP image or a PDF document.');
      return;
    }

    if (selectedFile.size > maxSize) {
      toast.error('File is too large. Maximum size is 5MB.');
      return;
    }

    setFile(selectedFile);
    setUploadStatus('idle');
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = async () => {
    if (!file || !user) return;

    setIsUploading(true);
    setUploadStatus('idle');
    const supabase = createClient();

    try {
      const timestamp = Date.now();
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/${timestamp}_${productName.replace(/[^a-zA-Z0-9]/g, '_')}.${fileExt}`;

      // 1. Upload to Supabase Private Storage Bucket "prescriptions"
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('prescriptions')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // 2. Resolve final file URL
      const fileUrl = filePath; // Save relative storage path, resolved securely via signed URL later

      // 3. Insert into public.rx_submissions DB table
      const { error: dbError } = await (supabase.from('rx_submissions') as any).insert({
        user_id: user.id,
        thread_id: threadId,
        product_name: productName,
        file_url: fileUrl,
        status: 'submitted',
      });

      if (dbError) throw dbError;

      setUploadStatus('success');
      toast.success('Prescription uploaded successfully!');
      onSuccess(fileUrl);
    } catch (err: any) {
      console.error('Upload failed:', err);
      setUploadStatus('error');
      toast.error(err.message || 'Prescription upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="w-full bg-white border border-slate-200 rounded-2xl p-5 shadow-md flex flex-col items-center">
      <div className="text-left w-full mb-4">
        <h4 className="text-sm font-bold text-slate-900">Upload Prescription</h4>
        <p className="text-xs text-slate-500 mt-0.5">
          Please upload a valid doctor&apos;s prescription for <span className="font-semibold text-slate-800">{productName}</span>.
        </p>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept=".jpg,.jpeg,.png,.webp,.pdf"
      />

      {uploadStatus !== 'success' ? (
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={triggerFileSelect}
          className={`w-full border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${
            file
              ? 'border-blue-300 bg-blue-50/20'
              : 'border-slate-300 hover:border-blue-400 bg-slate-50 hover:bg-blue-50/10'
          }`}
        >
          {file ? (
            <FileText className="w-10 h-10 text-blue-500 mb-2" />
          ) : (
            <Upload className="w-10 h-10 text-slate-400 mb-2" />
          )}

          <span className="text-sm font-semibold text-slate-700">
            {file ? file.name : 'Choose file or drag & drop'}
          </span>
          <span className="text-xs text-slate-400 mt-1">
            {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'JPG, PNG, PDF up to 5MB'}
          </span>
        </div>
      ) : (
        <div className="w-full border border-green-200 bg-green-50/20 rounded-xl p-6 flex flex-col items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-green-500 mb-2" />
          <span className="text-sm font-semibold text-green-800">Upload Completed</span>
          <span className="text-xs text-green-600 mt-0.5">
            Your prescription is queued for pharmacist verification.
          </span>
        </div>
      )}

      {file && uploadStatus !== 'success' && (
        <div className="w-full mt-4 flex items-center space-x-3">
          <button
            onClick={() => setFile(null)}
            disabled={isUploading}
            className="flex-1 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg border border-slate-200 transition-colors"
          >
            Cancel
          </button>
          
          <button
            onClick={handleUpload}
            disabled={isUploading}
            className="flex-1 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg flex items-center justify-center space-x-2 transition-colors shadow-sm"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading...</span>
              </>
            ) : (
              <span>Submit prescription</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
