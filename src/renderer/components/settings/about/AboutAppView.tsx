import React from 'react';
import { Info } from 'lucide-react';
import SettingsLayout from '../SettingsLayout';
import AboutAppContentView from './AboutAppContentView';
import { APP_NAME, BRAND_CONFIG } from '@shared/constants/branding';

const AboutAppView: React.FC = () => {
  const brandDisplayName = BRAND_CONFIG.productName || APP_NAME;

  return (
    <SettingsLayout icon={<Info size={18} />} title={`About ${brandDisplayName}`}>
      <AboutAppContentView />
    </SettingsLayout>
  );
};

export default AboutAppView;
