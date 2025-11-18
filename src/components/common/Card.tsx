import { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'default' | 'glass' | 'gradient';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
}

export function Card({
  children,
  className,
  variant = 'default',
  padding = 'md',
  hover = false,
  ...props
}: CardProps) {
  const variants = {
    default: 'bg-white border border-gray-200 shadow-sm',
    glass: 'bg-white bg-opacity-10 backdrop-blur-lg border border-white border-opacity-20',
    gradient: 'bg-gradient-to-br from-white to-gray-50 border border-gray-200',
  };

  const paddings = {
    none: '',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  };

  const hoverEffect = hover ? 'hover:scale-105 hover:shadow-lg transition-transform duration-200 cursor-pointer' : '';

  return (
    <div
      className={clsx('rounded-3xl', variants[variant], paddings[padding], hoverEffect, className)}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardHeader({ children, className, ...props }: CardHeaderProps) {
  return (
    <div className={clsx('mb-4', className)} {...props}>
      {children}
    </div>
  );
}

interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

export function CardTitle({ children, className, as: Component = 'h3', ...props }: CardTitleProps) {
  return (
    <Component className={clsx('text-2xl font-bold', className)} {...props}>
      {children}
    </Component>
  );
}

interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardContent({ children, className, ...props }: CardContentProps) {
  return (
    <div className={clsx(className)} {...props}>
      {children}
    </div>
  );
}
