import brandConfig from '../../../brands/deskmate/config.json';

export const BRAND_NAME = 'deskmate';
export const BRAND_CONFIG = brandConfig;
export const APP_NAME: string = brandConfig.productName;
export const APP_ID: string = brandConfig.appId;

export const getWindowTitle = () =>
  brandConfig.windowTitle || `${APP_NAME} AI Studio`;
