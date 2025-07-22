/// <reference types="vite/client" />
/**
 * debateApi.ts
 * 用于与Multi-Agent Debate服务器通信的前端API接口
 */

// 辩论服务器基础URL
const DEBATE_API_BASE_URL = import.meta.env.PROD   
? 'https://artagent.onrender.com/api'  // 生产环境 - 请替换为您的实际后端URL  
: 'http://localhost:3002/api';  // 开发环境

/**
 * Agent回复回调函数类型
 */
export type AgentResponseCallback = (
  agentTitle: string, 
  response: string, 
  similarity: number,
  isComplete: boolean,
  orderedAgents?: string[],
  similarities?: {[agentTitle: string]: number},
  index?: number
) => void;

/**
 * 发送消息到辩论服务器
 * @param message 用户消息
 * @param agentTitles 参与辩论的Agent标题数组
 * @param artworkUrls 画作URL数组，可选
 * @param onAgentResponse 可选回调函数，用于接收每个Agent的回复
 * @param resetConversation 是否重置对话，默认为false
 * @param sessionId 会话ID，默认为'default'
 * @returns 包含所有Agent响应、相似度和顺序的对象
 */
export async function sendMessageToDebate(
  message: string,
  agentTitles: string[],
  artworkUrls?: string[] | null,
  onAgentResponse?: AgentResponseCallback,
  resetConversation: boolean = false,
  sessionId: string = 'default'
): Promise<{
  responses: { [agentTitle: string]: string },
  similarities: { [agentTitle: string]: number },
  orderedAgents: string[]
}> {
  try {
    // 确保至少有一个Agent
    if (!agentTitles || agentTitles.length === 0) {
      throw new Error('需要提供至少一个智能体');
    }

    let fileIds: string[] = [];
    
    // 处理图片上传
    if (artworkUrls && artworkUrls.length > 0) {
      console.log(`准备上传 ${artworkUrls.length} 张图片:`, artworkUrls);
      
      // 串行上传图片，避免并发问题
      for (const url of artworkUrls) {
        try {
          const fileId = await uploadFile(url);
          if (fileId) {
            fileIds.push(fileId);
            console.log(`成功上传图片并获取文件ID: ${fileId}`);
          }
        } catch (error) {
          console.error(`上传图片失败: ${url}`, error);
        }
      }
      
      console.log(`成功上传了 ${fileIds.length}/${artworkUrls.length} 张图片，获取到文件ID:`, fileIds);
    }
    
    // 构建请求体
    const requestBody = {
      agentTitles,
      message,
      fileIds,
      sessionId,
      resetConversation,
    };
    
    console.log('发送辩论请求:', JSON.stringify(requestBody));
    
    // 发送请求到辩论服务器
    const response = await fetch(`${DEBATE_API_BASE_URL}/debate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API请求失败:', errorText);
      throw new Error(`API请求失败: ${response.status} ${response.statusText}, ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || '未知错误');
    }
    
    // 返回所有Agent的回复、相似度和顺序
    console.log('获取到辩论回复:', data);
    return {
      responses: data.responses,
      similarities: data.similarities || {},
      orderedAgents: data.orderedAgents || agentTitles
    };
  } catch (error) {
    console.error('发送辩论消息失败:', error);
    // 创建一个所有Agent都显示错误的回复对象
    const errorResponses: { [agentTitle: string]: string } = {};
    const errorSimilarities: { [agentTitle: string]: number } = {};
    
    agentTitles.forEach(agentTitle => {
      errorResponses[agentTitle] = `发送消息失败: ${error instanceof Error ? error.message : '未知错误'}`;
      errorSimilarities[agentTitle] = 0;
    });
    
    return {
      responses: errorResponses,
      similarities: errorSimilarities,
      orderedAgents: agentTitles
    };
  }
}

/**
 * 重置辩论会话
 * @param sessionId 会话ID，默认为'default'
 */
export async function resetDebateSession(sessionId: string = 'default'): Promise<void> {
  try {
    const response = await fetch(`${DEBATE_API_BASE_URL}/debate/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('重置辩论会话失败:', errorText);
      throw new Error(`重置辩论会话失败: ${response.status} ${response.statusText}, ${errorText}`);
    }
    
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || '未知错误');
    }
    
    console.log('辩论会话重置成功');
  } catch (error) {
    console.error('重置辩论会话失败:', error);
    throw error;
  }
}

/**
 * 获取辩论历史
 * @param sessionId 会话ID，默认为'default'
 */
export async function getDebateHistory(sessionId: string = 'default'): Promise<any[]> {
  try {
    const response = await fetch(`${DEBATE_API_BASE_URL}/debate/history?sessionId=${sessionId}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('获取辩论历史失败:', errorText);
      throw new Error(`获取辩论历史失败: ${response.status} ${response.statusText}, ${errorText}`);
    }
    
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || '未知错误');
    }
    
    return data.history || [];
  } catch (error) {
    console.error('获取辩论历史失败:', error);
    return [];
  }
}

/**
 * 发送流式消息到辩论服务器，使用SSE获取实时回复
 * @param message 用户消息
 * @param agentTitles 参与辩论的Agent标题数组
 * @param onAgentResponse 回调函数，用于接收每个Agent的回复
 * @param artworkUrls 画作URL数组，可选
 * @param resetConversation 是否重置对话，默认为false
 * @param sessionId 会话ID，默认为'default'
 * @returns 一个函数，调用后可以关闭SSE连接
 */
export function sendStreamingMessageToDebate(
  message: string,
  agentTitles: string[],
  onAgentResponse: AgentResponseCallback,
  artworkUrls?: string[] | null,
  resetConversation: boolean = false,
  sessionId: string = 'default'
): () => void {
  // 确保至少有一个Agent
  if (!agentTitles || agentTitles.length === 0) {
    onAgentResponse('', '需要提供至少一个智能体', 0, true);
    return () => {};
  }

  let fileIds: string[] = [];
  let aborted = false;
  let eventSource: EventSource | null = null;
  
  // 处理图片上传并启动SSE连接
  (async () => {
    try {
      // 处理图片上传
      if (artworkUrls && artworkUrls.length > 0) {
        console.log(`准备上传 ${artworkUrls.length} 张图片:`, artworkUrls);
        
        // 串行上传图片，避免并发问题
        for (const url of artworkUrls) {
          if (aborted) return;
          
          try {
            const fileId = await uploadFile(url);
            if (fileId) {
              fileIds.push(fileId);
              console.log(`成功上传图片并获取文件ID: ${fileId}`);
            }
          } catch (error) {
            console.error(`上传图片失败: ${url}`, error);
          }
        }
        
        console.log(`成功上传了 ${fileIds.length}/${artworkUrls.length} 张图片，获取到文件ID:`, fileIds);
      }
      
      if (aborted) return;
      
      // 构建请求体
      const requestBody = {
        agentTitles,
        message,
        fileIds,
        sessionId,
        resetConversation,
      };
      
      console.log('发送流式辩论请求:', JSON.stringify(requestBody));
      
      // 先发送POST请求，然后使用返回的会话ID创建EventSource连接
      const response = await fetch(`${DEBATE_API_BASE_URL}/debate/stream/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('初始化流式辩论失败:', errorText);
        onAgentResponse('', `初始化流式辩论失败: ${response.status} ${response.statusText}`, 0, true);
        return;
      }
      
      // 解析响应，获取流ID
      const data = await response.json();
      if (!data.success || !data.streamId) {
        console.error('初始化流式辩论失败:', data.error || '未返回streamId');
        onAgentResponse('', `初始化流式辩论失败: ${data.error || '未返回streamId'}`, 0, true);
        return;
      }
      
      const streamId = data.streamId;
      console.log('获取到流ID:', streamId);
      
      // 创建EventSource连接
      eventSource = new EventSource(`${DEBATE_API_BASE_URL}/debate/stream/${streamId}`);
      
      // 处理连接打开
      eventSource.onopen = () => {
        console.log('SSE连接已打开');
      };
      
      // 处理消息
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('收到SSE消息:', data);
          
          switch (data.type) {
            case 'order':
              // 收到排序信息，可以先准备UI
              console.log('Agent排序:', data.orderedAgents);
              console.log('Agent相似度:', data.similarities);
              
              // 将排序信息传递给回调函数
              if (data.orderedAgents && Array.isArray(data.orderedAgents)) {
                onAgentResponse('', 'order', 0, false, data.orderedAgents, data.similarities);
              }
              break;
              
            case 'response':
              // 收到单个Agent的回复
              onAgentResponse(
                data.agentTitle,
                data.response,
                data.similarity,
                data.isComplete,
                undefined,
                undefined,
                data.index
              );
              break;
              
            case 'complete':
              // 所有Agent都已回复完成
              console.log('所有Agent回复完成');
              if (eventSource) eventSource.close();
              break;
              
            case 'error':
              // 发生错误
              console.error('流式辩论错误:', data.error);
              onAgentResponse('', data.error, 0, true);
              if (eventSource) eventSource.close();
              break;
          }
        } catch (error) {
          console.error('解析SSE消息失败:', error, event.data);
        }
      };
      
      // 处理错误
      eventSource.onerror = (error) => {
        console.error('SSE连接错误:', error);
        if (eventSource) eventSource.close();
      };
    } catch (error) {
      console.error('处理流式辩论请求失败:', error);
      onAgentResponse('', `处理请求失败: ${error instanceof Error ? error.message : '未知错误'}`, 0, true);
    }
  })();
  
  // 返回一个函数，用于关闭连接
  return () => { 
    aborted = true; 
    if (eventSource) {
      eventSource.close();
    }
  };
}

/**
 * 上传文件到服务器
 * @param url 文件URL
 * @returns 文件ID
 */
async function uploadFile(url: string): Promise<string> {
  try {
    console.log('开始上传图片:', url);
    
    // 从URL获取文件
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`获取图片失败: ${response.status} ${response.statusText}`);
    }
    
    const blob = await response.blob();
    console.log('获取到图片Blob:', blob.type, blob.size);
    
    // 创建FormData对象
    const formData = new FormData();
    formData.append('file', blob, 'artwork.jpg');
    
    // 上传文件
    console.log('开始发送上传请求');
    const uploadResponse = await fetch(`${DEBATE_API_BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`上传请求失败: ${uploadResponse.status} ${uploadResponse.statusText}, ${errorText}`);
    }
    
    const uploadData = await uploadResponse.json();
    console.log('上传响应:', uploadData);
    
    if (!uploadData.success) {
      throw new Error(uploadData.error || '未知错误');
    }
    
    // 确保返回正确的文件ID
    if (!uploadData.fileData?.data?.id) {
      console.error('上传响应中缺少文件ID:', uploadData);
      throw new Error('上传成功但未返回文件ID');
    }
    
    // 返回文件ID
    console.log('获取到文件ID:', uploadData.fileData.data.id);
    return uploadData.fileData.data.id;
  } catch (error) {
    console.error('上传文件失败:', error);
    throw error;
  }
} 
