'use client';

import * as React from 'react';
import {
  Toaster as Sonner,
  toast as sonnerToast,
  type ToasterProps as SonnerToasterProps,
} from 'sonner';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
} from 'lucide-react';
import styles from './sonner.module.css';

export type ToasterProps = SonnerToasterProps;

export type ToastInput =
  | string
  | React.ReactNode
  | {
    title?: React.ReactNode;
    description?: React.ReactNode;
    [key: string]: unknown;
  };

function parseToastInput(
  input: ToastInput,
  defaultOptions?: Parameters<typeof sonnerToast.success>[1],
) {
  if (
    typeof input === 'object' &&
    input !== null &&
    !React.isValidElement(input) &&
    ('title' in input || 'description' in input)
  ) {
    const { title, description, ...rest } = input as {
      title?: React.ReactNode;
      description?: React.ReactNode;
      [key: string]: unknown;
    };
    return {
      message: (title ?? '') as React.ReactNode,
      options: {
        ...(description !== undefined ? { description } : {}),
        ...rest,
        ...defaultOptions,
      },
    };
  }
  return {
    message: input as React.ReactNode,
    options: defaultOptions,
  };
}

const toast = Object.assign(
  (input: ToastInput, data?: Parameters<typeof sonnerToast>[1]) => {
    const { message, options } = parseToastInput(input, data);
    return sonnerToast(message, options);
  },
  {
    ...sonnerToast,
    success: (
      input: ToastInput,
      data?: Parameters<typeof sonnerToast.success>[1],
    ) => {
      const { message, options } = parseToastInput(input, data);
      return sonnerToast.success(message, options);
    },
    error: (
      input: ToastInput,
      data?: Parameters<typeof sonnerToast.error>[1],
    ) => {
      const { message, options } = parseToastInput(input, data);
      return sonnerToast.error(message, options);
    },
    info: (
      input: ToastInput,
      data?: Parameters<typeof sonnerToast.info>[1],
    ) => {
      const { message, options } = parseToastInput(input, data);
      return sonnerToast.info(message, options);
    },
    warning: (
      input: ToastInput,
      data?: Parameters<typeof sonnerToast.warning>[1],
    ) => {
      const { message, options } = parseToastInput(input, data);
      return sonnerToast.warning(message, options);
    },
    loading: (
      input: ToastInput,
      data?: Parameters<typeof sonnerToast.loading>[1],
    ) => {
      const { message, options } = parseToastInput(input, data);
      return sonnerToast.loading(message, options);
    },
    promise: <T,>(
      promise: Promise<T> | (() => Promise<T>),
      data?: {
        loading?: ToastInput;
        success?: ToastInput | ((data: T) => ToastInput);
        error?: ToastInput | ((error: unknown) => ToastInput);
        description?: ToastInput | ((data: unknown) => ToastInput);
        finally?: () => void | Promise<void>;
      },
    ) => {
      if (!data) return sonnerToast.promise(promise as Promise<T>);

      const normalizeItem = (item: unknown) => {
        if (item === undefined) return undefined;
        if (typeof item === 'function') {
          return async (val: unknown) => {
            const resolved = await (item as (arg: unknown) => unknown)(val);
            if (
              typeof resolved === 'object' &&
              resolved !== null &&
              !React.isValidElement(resolved) &&
              ('title' in resolved || 'description' in resolved)
            ) {
              const { title, description, ...rest } = resolved as {
                title?: React.ReactNode;
                description?: React.ReactNode;
                [key: string]: unknown;
              };
              return { message: title, description, ...rest };
            }
            return resolved;
          };
        }
        if (
          typeof item === 'object' &&
          item !== null &&
          !React.isValidElement(item) &&
          ('title' in item || 'description' in item)
        ) {
          const { title, description, ...rest } = item as {
            title?: React.ReactNode;
            description?: React.ReactNode;
            [key: string]: unknown;
          };
          return { message: title, description, ...rest };
        }
        return item;
      };

      return sonnerToast.promise(promise as Promise<T>, {
        loading: normalizeItem(data.loading) as never,
        success: normalizeItem(data.success) as never,
        error: normalizeItem(data.error) as never,
        description: data.description as never,
        finally: data.finally,
      });
    },
  },
);

function useAutoTheme(forcedTheme?: ToasterProps['theme']) {
  const [theme, setTheme] = React.useState<ToasterProps['theme']>(
    forcedTheme ?? 'system',
  );

  React.useEffect(() => {
    if (forcedTheme) {
      setTheme(forcedTheme);
      return;
    }

    const checkTheme = () => {
      if (typeof document === 'undefined') return;
      const isDark =
        document.documentElement.classList.contains('dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark' ||
        document.body?.classList.contains('dark');
      setTheme(isDark ? 'dark' : 'light');
    };

    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    return () => observer.disconnect();
  }, [forcedTheme]);

  return theme;
}

export function Toaster({
  position = 'top-center',
  theme: explicitTheme,
  className,
  toastOptions,
  ...props
}: ToasterProps) {
  const activeTheme = useAutoTheme(explicitTheme);

  return (
    <Sonner
      theme={activeTheme}
      className={styles.toaster}
      position={position}
      // closeButton
      icons={{
        success: (
          <CheckCircle2
            size={18}
            style={{ color: '#059669', flexShrink: 0 }}
          />
        ),
        info: (
          <Info
            size={18}
            style={{ color: '#0284c7', flexShrink: 0 }}
          />
        ),
        warning: (
          <AlertTriangle
            size={18}
            style={{ color: '#d97706', flexShrink: 0 }}
          />
        ),
        error: (
          <AlertCircle
            size={18}
            style={{ color: '#e11d48', flexShrink: 0 }}
          />
        ),
        loading: (
          <Loader2
            size={18}
            style={{
              color: '#2563eb',
              flexShrink: 0,
              animation: 'spin 1s linear infinite',
            }}
          />
        ),
      }}
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast: styles.toast,
          title: styles.title,
          description: styles.description,
          actionButton: styles.actionButton,
          cancelButton: styles.cancelButton,
          closeButton: styles.closeButton,
          success: styles.success,
          info: styles.info,
          warning: styles.warning,
          error: styles.error,
          default: styles.default,
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
}

export { toast };
