import { Toaster as SonnerToaster } from 'sonner';

export const Toaster = () => {
  return (
    <SonnerToaster
      position="top-right"
      expand={false}
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: 'rounded-lg shadow-lg',
          title: 'text-sm font-semibold',
          description: 'text-sm',
          actionButton: 'bg-blue-600 text-white',
          cancelButton: 'bg-gray-100',
          closeButton: 'bg-white border border-gray-200',
        },
      }}
    />
  );
};
