import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shadcn/card';

/**
 * GitHub Copilot 登录入口的占位页面。
 *
 * 老的 OAuth / Device Code Flow 已在 renderer 侧整体下架，后续登录会重做。
 * 这里仅保留 `/login` 路由，提供一个友好的回退 UI：
 * 引导用户回到工作区，或在 Settings → Provider 中配置 LLM provider。
 */
export const SignInPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="h-full flex items-center justify-center bg-linear-to-br from-[#FFFBF8] via-white to-[#F8F4F1] p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">Sign in page</CardTitle>
          <CardDescription className="text-center">
            登录子系统正在重做。现在请通过{' '}
            <span className="font-medium">Settings → Provider</span>{' '}
            配置 LLM provider，即可正常使用工作区。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button variant="default" onClick={() => navigate('/agent')}>
            <ArrowLeft size={16} strokeWidth={1.5} />
            <span>Back to Workspace</span>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
