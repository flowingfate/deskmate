export interface UserInputField {
  key: string;
  originalValue: string;
  type: 'STRING' | 'INT' | 'DOUBLE' | 'BOOLEAN';
  control: 'folder' | 'file' | 'text';
  varName: string;
  isRequired: boolean;
  label: string;
  defaultValue?: string;
}

export interface ParseUserInputResult {
  fields: UserInputField[];
  hasUserInputFields: boolean;
}
