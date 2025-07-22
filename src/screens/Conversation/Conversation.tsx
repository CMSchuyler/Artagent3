import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from "react-router-dom";
import { ImageCompareSlider } from '../../components/ImageCompareSlider';
import { liblibAIService } from '../../lib/liblibai';
import { sendMessageToDebate, resetDebateSession, sendStreamingMessageToDebate, AgentResponseCallback } from '../../lib/debateApi';
// 直接在组件内部添加样式，避免模块导入问题

interface ConversationState {
  selectedPaintings: number[];
  selectedMode: number | null;
  selectedAgents: number[];
  appreciationAgents: {
    id: number;
    title: string;
    imageSrc: string;
  }[];
  appreciationModes: {
    id: number;
    title: string;
  }[];
  artworkImages: {
    id: number;
    src: string;
    alt: string;
  }[];
}

// Special agent constants
const VTS_AGENT_ID = 999;
const VTS_AGENT = {
  id: VTS_AGENT_ID,
  title: "VTS",
  imageSrc: "/VTS.png",
  isVtsAgent: true
};

// 特殊代理ID列表，这些代理不能被拖放到未选择区域
const SPECIAL_AGENT_IDS = [VTS_AGENT_ID];

// 预设问题配置
/* 
const PRESET_QUESTIONS = {
  'Comparisons': [
    "帮我分析下这几幅画的构图怎么样?",
    "这几幅画的色彩有何独特之处?",
    "这几幅画风格技法有何不同?"
  ],
  'Connections': [
    "这几幅画的时代背景对它们有何影响?",
    "画家的生平经历怎样影响了这几幅画?",
    "这几幅画在艺术发展中有怎样的地位?"
  ],
  'Expansions': [
    "这幅画属于什么艺术流派?",
    "它对后世艺术有哪些影响?",
    "从文化角度看这幅画有何意义?"
  ]
};
*/

// 添加自定义滚动条样式
const scrollbarStyles = `
  .custom-scrollbar::-webkit-scrollbar {
    height: 8px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 4px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #57c2f3;
    border-radius: 4px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #4ab3e8;
  }
  
  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: #57c2f3 #f1f1f1;
  }
`;

// 图片详细信息映射
const paintingInfoMap: Record<string, string> = {
  'xrk1.jpeg': '《向日葵》文森特·梵高（Vincent van Gogh，荷兰，1887–1889年）',
  'xrk2.jpeg': '《向日葵花束》克劳德·莫奈（Claude Monet，法国，1881年）',
  'xrk3.jpeg': '《向日葵》古斯塔夫·克里姆特（Gustav Klimt，奥地利，1906–1908）',
  'xrk4.jpeg': '《向日葵》埃贡·席勒（Egon Schiele，奥地利，1909）',
  'xrk5.jpeg': '《三十朵向日葵》大卫・霍克尼（David Hockney，英国，1996）',
};

/**
 * 格式化智能体回复，去除*和**，将###替换为换行
 * @param reply 智能体原始回复
 * @returns 格式化后的回复
 */
function formatAgentReply(reply: string): string {
  return reply
    .replace(/\*\*|\*/g, '')
    .replace(/###/g, '\n')
    .replace(/[（(]\s*\d+\s*字\s*[左右]*\s*[）)]/g, '')
    .replace(/<\|FunctionCallEnd\|>/g, '');
}

// 在文件顶部添加统一API基础地址
const API_BASE_URL = import.meta.env.PROD
  ? 'https://artagent.onrender.com/api' // 生产环境 - 请替换为实际后端URL
  : 'http://localhost:3002/api'; // 开发环境

export const Conversation = (): JSX.Element => {
  const location = useLocation();
  const state = location.state as ConversationState;
  
  // 添加清除localStorage的函数
  const clearLocalStorageSelections = () => {
    localStorage.removeItem('selectedMode');
    localStorage.removeItem('selectedPaintings');
    localStorage.removeItem('selectedAgents');
    console.log('Cleared selection data from localStorage');
  };
  
  // 监听页面刷新事件，在页面刷新前清除localStorage
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      clearLocalStorageSelections();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);
  
  // Extract data from state
  const { 
    selectedPaintings, 
    selectedMode, 
    selectedAgents,
    appreciationAgents,
    appreciationModes,
    artworkImages 
  } = state;

  // Find the selected agents data
  const selectedAgentsData = appreciationAgents.filter(agent => selectedAgents.includes(agent.id));
  
  // Use the first agent as primary for now (for message display)
  const primaryAgent = selectedAgentsData[0];
  
  // 根据Agent类型返回符合身份的开场白
  const getAgentGreeting = (agentTitle: string): string => {
    switch (agentTitle) {
      case "Art Critic":
        return "你好！我是艺术评论家。这幅画给你留下了什么印象？";
      case "Art Historian":
        return "你好！作为艺术史学家，我很想听听你对这幅画的看法。";
      case "Art Collector":
        return "你好！从收藏家的角度，我对这幅画很感兴趣。你有什么想法？";
      case "Art Theorist":
        return "你好！作为艺术理论家，我很想了解你对这幅画的感受。";
      case "General Audience":
        return "你好！很高兴与你一起欣赏这幅画。有什么想分享的吗？";
      case "Painter":
        return "你好！作为一名画家，我对这幅画很感兴趣。你有什么想法？";
      default:
        return "你好！关于这幅画，你有什么想说的吗？";
    }
  };
  
  // Load initial state from localStorage or from router state
  const initialMode = React.useMemo(() => {
    try {
      const savedMode = localStorage.getItem('selectedMode');
      return savedMode ? JSON.parse(savedMode) : selectedMode;
    } catch (e) {
      console.error("Failed to load mode from localStorage", e);
      return selectedMode;
    }
  }, [selectedMode]);

  const initialAgents = React.useMemo(() => {
    try {
      const savedAgents = localStorage.getItem('selectedAgents');
      return savedAgents ? JSON.parse(savedAgents) : selectedAgents;
    } catch (e) {
      console.error("Failed to load agents from localStorage", e);
      return selectedAgents;
    }
  }, [selectedAgents]);

  // Local state for selected mode and agents (to allow modifications)
  const [localSelectedMode, setLocalSelectedMode] = React.useState<number | null>(initialMode);
  const [localSelectedAgents, setLocalSelectedAgents] = React.useState<number[]>(initialAgents);
  
  // State for active appreciation method
  const [activeMethod, setActiveMethod] = React.useState<string | null>(null);
  
  // Save selections to localStorage when they change
  React.useEffect(() => {
    try {
      localStorage.setItem('selectedMode', JSON.stringify(localSelectedMode));
      
      // 检查是否为Single-Agent Dialogue模式（假设ID为1）
      if (localSelectedMode === 1) {
        // 检查是否有VTS代理
        const hasVTSAgent = localSelectedAgents.includes(VTS_AGENT_ID);
        
        // 如果有多个代理，只保留第一个非特殊代理和VTS代理（如果有的话）
        if (localSelectedAgents.length > 1) {
          // 获取第一个非特殊代理
          const regularAgents = localSelectedAgents.filter(id => !SPECIAL_AGENT_IDS.includes(id));
          if (regularAgents.length > 0) {
            // 如果有VTS代理，保留VTS代理和第一个普通代理
            if (hasVTSAgent) {
              setLocalSelectedAgents([regularAgents[0], VTS_AGENT_ID]);
            } else {
              // 否则只保留第一个普通代理
              setLocalSelectedAgents([regularAgents[0]]);
            }
          } else if (hasVTSAgent) {
            // 如果没有普通代理但有VTS代理，只保留VTS代理
            setLocalSelectedAgents([VTS_AGENT_ID]);
          }
        }
      }
    } catch (e) {
      console.error("Failed to save mode to localStorage", e);
    }
  }, [localSelectedMode, localSelectedAgents]);
  
  React.useEffect(() => {
    try {
      localStorage.setItem('selectedAgents', JSON.stringify(localSelectedAgents));
    } catch (e) {
      console.error("Failed to save agents to localStorage", e);
    }
  }, [localSelectedAgents]);
  
  // 保存多选模式下的选中状态，初始为空数组，稍后会更新
  const [multiSelectPaintings, setMultiSelectPaintings] = React.useState<number[]>([]);
  
  // 获取当前选择的代理标题
  const getSelectedAgentTitle = (): string => {
    // 获取当前选中的第一个代理
    const selectedAgentData = appreciationAgents.find(agent => localSelectedAgents.includes(agent.id));
    return selectedAgentData?.title || "Art Critic"; // 默认使用Art Critic
  };

  // 获取当前选择的画作URL
  const getSelectedArtworkUrl = (): string | null => {
    if (!activePainting) return null;
    const artwork = artworkImages.find(img => img.id === activePainting);
    return artwork?.src || null;
  };
  
  // 获取所有选中画作的URL数组
  const getSelectedArtworksUrls = (): string[] => {
    // 在多选模式下返回所有选中的画作URL
    if (isMultiSelectMode(activeMethod) && selectedMultiplePaintings.length > 0) {
      return selectedMultiplePaintings
        .map(id => artworkImages.find(img => img.id === id)?.src)
        .filter((url): url is string => url !== undefined);
    }
    // 在单选模式下只返回当前活跃画作的URL
    const url = getSelectedArtworkUrl();
    return url ? [url] : [];
  };
  
  // 初始化多选状态 - 只在组件挂载时运行一次
  React.useEffect(() => {
    if (activePainting !== null) {
      setMultiSelectPaintings([activePainting]);
    } else if (selectedPaintings.length > 0) {
      setMultiSelectPaintings([selectedPaintings[0]]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 空依赖数组，只在组件挂载时运行
  
  // 移除所有特殊代理
  const removeAllSpecialAgents = () => {
    setLocalSelectedAgents(localSelectedAgents.filter(id => !SPECIAL_AGENT_IDS.includes(id)));
  };
  
  // 检查是否为多选模式（Comparisons或Connections）
  const isMultiSelectMode = (method: string | null): boolean => {
    return method === 'Comparisons' || method === 'Connections';
  };
  
  // Handle method activation/deactivation
  const handleMethodChange = (method: string | null) => {
    // 如果取消选择当前方法
    if (method === null) {
      // 检查是否是从VTS模式取消
      const wasVTSMode = activeMethod === 'VTS';
      
      // 移除所有特殊代理
      removeAllSpecialAgents();
      setActiveMethod(null);
      
      // 如果当前是多选模式，保存选中状态
      if (isMultiSelectMode(activeMethod)) {
        setMultiSelectPaintings([...selectedMultiplePaintings]);
      }
      
      // 重置为单选状态
      if (activePainting) {
        setSelectedMultiplePaintings([activePainting]);
      }
      
      // 如果是从VTS模式取消，重置聊天框
      if (wasVTSMode) {
        // 根据当前模式重置聊天框
        if (localSelectedMode === 1) {
          // 单Agent模式 - 显示单个Agent的开场白
        const selectedRegularAgent = appreciationAgents.find(agent => 
          localSelectedAgents.includes(agent.id) && !SPECIAL_AGENT_IDS.includes(agent.id)
        );
        
        const agentTitle = selectedRegularAgent?.title || "Art Critic";
        
        // 重置聊天记录，只保留初始消息
        setMessages([
          {
            id: 1,
            sender: "agent",
            text: getAgentGreeting(agentTitle),
            timestamp: new Date(),
            agentType: "regular",
            agentTitle: agentTitle,
            agentImage: selectedRegularAgent?.imageSrc || "/Art Critic.png"
          }
        ]);
        } else {
          // 多Agent模式 - 显示所有选中Agent的开场白
          const initialMessages: ChatMessage[] = [];
          let messageId = 1;
          
          // 获取所有选中的普通Agent数据
          const selectedAgentsData = appreciationAgents.filter(agent => 
            localSelectedAgents.includes(agent.id) && !SPECIAL_AGENT_IDS.includes(agent.id)
          );
          
          // 为每个Agent创建开场白消息
          selectedAgentsData.forEach(agent => {
            initialMessages.push({
              id: messageId++,
              sender: "agent",
              text: getAgentGreeting(agent.title),
              timestamp: new Date(),
              agentType: "regular",
              agentTitle: agent.title,
              agentImage: agent.imageSrc
            });
          });
          
          // 设置初始消息
          setMessages(initialMessages);
        }
        
        // 重置VTS对话状态
        setVtsDialogueState('vts_turn');
      }
      
      return;
    }
    
    // 如果选择了新方法，先移除所有特殊代理
    removeAllSpecialAgents();
    
    // 设置活跃方法
    setActiveMethod(method);
    
    // 根据选择的方法添加对应的特殊代理
    if (method === 'VTS') {
      // VTS模式下重置为单选
      if (activePainting) {
        setSelectedMultiplePaintings([activePainting]);
      }
      
      // 重置VTS对话状态
      setVtsDialogueState('vts_turn');
      
        // 获取当前选中的画作URL
        const artworkUrls = getSelectedArtworksUrls();
        
        // 添加VTS加载中消息
        const vtsLoadingMessage = {
          id: messages.length + 1,
          sender: "agent" as const,
          text: `VTS 正在思考中`,
          timestamp: new Date(),
          isLoading: true,
          agentType: "vts" as const,
          agentTitle: "VTS",
          agentImage: VTS_AGENT.imageSrc
        };
        
        // 使用函数式更新避免依赖项问题
        setMessages(prevMessages => [...prevMessages, vtsLoadingMessage]);
        
        // 发送VTS初始化提示词到服务器
        const vtsPrompt = "你来一步步引导我观察这幅画吧。";
      
      // 重置VTS对话状态 - 调用API重置VTS的对话
      (async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/chat/reset`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              agentTitle: "VTS",
              sessionId: 'vts_session' // 使用独立的会话ID
            }),
          });
          
          if (!response.ok) {
            console.error('重置VTS对话失败:', await response.text());
          } else {
            console.log('成功重置VTS对话状态');
          }
        } catch (error) {
          console.error('重置VTS对话请求失败:', error);
        }
      })();
        
        // 异步发送请求
        (async () => {
          try {
          // 使用resetConversation=false以保持VTS对话的连续性，仅在API重置后创建新对话
          // 注意：使用独立的sessionId 'vts_session'
          const vtsResponse = await sendMessageToServer(vtsPrompt, "VTS", artworkUrls, false, 'vts_session');
            
            // 更新VTS回复 - 使用函数式更新
            setMessages(prevMessages => 
              prevMessages.map(msg => 
                msg.id === vtsLoadingMessage.id 
                  ? {
                      id: msg.id,
                      sender: "agent" as const,
                      text: formatAgentReply(vtsResponse),
                      timestamp: new Date(),
                      isLoading: false,
                      agentType: "vts" as const,
                      agentTitle: "VTS",
                      agentImage: VTS_AGENT.imageSrc
                    }
                  : msg
              )
            );
          } catch (error) {
            console.error('获取VTS回复失败:', error);
            
            // 更新为错误消息 - 使用函数式更新
            setMessages(prevMessages => 
              prevMessages.map(msg => 
                msg.id === vtsLoadingMessage.id 
                  ? {
                      id: msg.id,
                      sender: "agent" as const,
                      text: `抱歉，无法获取VTS引导: ${error instanceof Error ? error.message : '未知错误'}`,
                      timestamp: new Date(),
                      isLoading: false,
                      isError: true,
                      agentType: "vts" as const,
                      agentTitle: "VTS",
                      agentImage: VTS_AGENT.imageSrc
                    }
                  : msg
              )
            );
          }
        })();
    } 
    // Expansions方法只设置activeMethod，不添加特殊代理
    else if (method === 'Expansions') {
      // Expansions模式下重置为单选
      if (activePainting) {
        setSelectedMultiplePaintings([activePainting]);
      }
    }
    // 如果是多选模式，使用保存的多选状态或确保至少有一个画作被选中
    else if (isMultiSelectMode(method)) {
      if (isMultiSelectMode(activeMethod)) {
        // 如果之前也是多选模式，保持当前选择
        // 不做任何改变
      } else if (multiSelectPaintings.length > 0) {
        // 从单选模式切换到多选模式，使用保存的多选状态
        setSelectedMultiplePaintings([...multiSelectPaintings]);
        if (multiSelectPaintings.includes(activePainting || -1)) {
          // 如果当前活跃画作在多选列表中，保持不变
        } else if (multiSelectPaintings.length > 0) {
          // 否则设置多选列表中的第一个为活跃
          setActivePainting(multiSelectPaintings[0]);
        }
      } else if (activePainting !== null) {
        // 没有保存的多选状态，使用当前活跃画作
        setSelectedMultiplePaintings([activePainting]);
      }
    }
  };
  
  // Get current selected agents data based on local state
  const currentSelectedAgentsData = React.useMemo(() => {
    // 只获取普通agents
    return appreciationAgents.filter(agent => localSelectedAgents.includes(agent.id));
  }, [appreciationAgents, localSelectedAgents]);
  
  // Create a ref for dropdown container
  const modeDropdownRef = React.useRef<HTMLDivElement>(null);
  
  // State for agent selection management
  const [showUnselectedAgents, setShowUnselectedAgents] = React.useState<boolean>(false);
  const [unselectedAgents, setUnselectedAgents] = React.useState<typeof selectedAgentsData>([]);
  const [draggedAgent, setDraggedAgent] = React.useState<number | null>(null);
  const [activeAgent, setActiveAgent] = React.useState<number | null>(null);
  
  // Initialize unselected agents - 使用useMemo优化
  React.useEffect(() => {
    const allAgentsSet = new Set(appreciationAgents.map(agent => agent.id));
    const selectedAgentsSet = new Set(localSelectedAgents);
    const unselectedAgentIds = [...allAgentsSet].filter(id => !selectedAgentsSet.has(id));
    const unselectedAgentData = appreciationAgents.filter(agent => unselectedAgentIds.includes(agent.id));
    setUnselectedAgents(unselectedAgentData);
  }, [appreciationAgents, localSelectedAgents]);
  
  // 监听模式和画作变化的useEffect已经在上面实现
  
  // Function to remove an agent from selection
  const removeAgent = (agentId: number) => {
    // 在Single-Agent Dialogue模式下不允许移除代理
    if (localSelectedMode === 1) {
      console.log('Single-Agent Dialogue模式下不允许移除代理');
      return;
    }
    
    const agentToRemove = appreciationAgents.find(agent => agent.id === agentId);
    if (agentToRemove) {
      setUnselectedAgents([...unselectedAgents, agentToRemove]);
      setLocalSelectedAgents(localSelectedAgents.filter(id => id !== agentId));
    }
  };
  
  // Function to add an agent to selection
  const addAgent = (agentId: number) => {
    // 检查是否为Single-Agent Dialogue模式（假设ID为1）
    if (localSelectedMode === 1) {
      // 在Single-Agent模式下，替换现有代理
      const newAgents = [...localSelectedAgents.filter(id => SPECIAL_AGENT_IDS.includes(id))];
      // 添加新选择的代理
      newAgents.push(agentId);
      
      // 更新选中的代理
      setLocalSelectedAgents(newAgents);
      
      // 获取代理标题
      const agentTitle = appreciationAgents.find(agent => agent.id === agentId)?.title || "Art Critic";
      
      // 重置对话状态 - 调用API重置该Agent的对话
      (async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/chat/reset`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              agentTitle,
              sessionId: 'default'
            }),
          });
          
          if (!response.ok) {
            console.error('重置对话失败:', await response.text());
          } else {
            console.log(`成功重置Agent ${agentTitle} 的对话状态`);
          }
        } catch (error) {
          console.error('重置对话请求失败:', error);
        }
      })();
      
      // 重置聊天区
      const initialMessages = [
        {
          id: 1,
          sender: "agent" as const,
          text: getAgentGreeting(agentTitle),
          timestamp: new Date(),
          agentType: "regular" as const,
          agentTitle: agentTitle,
          agentImage: appreciationAgents.find(agent => agent.id === agentId)?.imageSrc
        }
      ];
      
      // 设置初始消息
      setMessages(initialMessages);
      
      // 如果VTS模式已激活，添加VTS初始化逻辑
      if (activeMethod === 'VTS' && newAgents.includes(VTS_AGENT_ID)) {
        // 获取当前选中的画作URL
        const artworkUrls = getSelectedArtworksUrls();
        
        // 添加VTS加载中消息
        const vtsLoadingMessage = {
          id: 2,
          sender: "agent" as const,
          text: `VTS 正在思考中`,
          timestamp: new Date(),
          isLoading: true,
          agentType: "vts" as const,
          agentTitle: "VTS",
          agentImage: VTS_AGENT.imageSrc
        };
        
        setMessages(prev => [...prev, vtsLoadingMessage]);
        
        // 发送VTS初始化提示词到服务器
        const vtsPrompt = "你来一步步引导我观察这幅画吧。";
        
        // 异步发送请求，重置VTS对话
        (async () => {
          try {
            const vtsResponse = await sendMessageToServer(vtsPrompt, "VTS", artworkUrls, false, 'vts_session');
            
            // 更新VTS回复
            setMessages(prev => prev.map(msg => 
              msg.id === vtsLoadingMessage.id 
                ? {
                    id: msg.id,
                    sender: "agent" as const,
                    text: formatAgentReply(vtsResponse),
                    timestamp: new Date(),
                    isLoading: false,
                    agentType: "vts" as const,
                    agentTitle: "VTS",
                    agentImage: VTS_AGENT.imageSrc
                  }
                : msg
            ));
          } catch (error) {
            console.error('获取VTS回复失败:', error);
            
            // 更新为错误消息
            setMessages(prev => prev.map(msg => 
              msg.id === vtsLoadingMessage.id 
                ? {
                    id: msg.id,
                    sender: "agent" as const,
                    text: `抱歉，无法获取VTS引导: ${error instanceof Error ? error.message : '未知错误'}`,
                    timestamp: new Date(),
                    isLoading: false,
                    isError: true,
                    agentType: "vts" as const,
                    agentTitle: "VTS",
                    agentImage: VTS_AGENT.imageSrc
                  }
                : msg
            ));
          }
        })();
      }
      
      console.log('Single-Agent模式下更换代理为:', agentId);
    } else {
      // 在多Agent模式下，添加到现有代理列表
      setLocalSelectedAgents([...localSelectedAgents, agentId]);
      
      // 获取新添加的代理数据
      const newAgent = appreciationAgents.find(agent => agent.id === agentId);
      
      // 如果找到代理数据，添加开场白
      if (newAgent) {
        const newAgentGreeting = {
          id: messages.length + 1,
          sender: "agent" as const,
          text: getAgentGreeting(newAgent.title),
          timestamp: new Date(),
          agentType: "regular" as const,
          agentTitle: newAgent.title,
          agentImage: newAgent.imageSrc
        };
        
        // 添加新代理的开场白到消息列表
        setMessages(prev => [...prev, newAgentGreeting]);
      }
    }
    
    // 从未选择区域移除该代理
    setUnselectedAgents(unselectedAgents.filter(agent => agent.id !== agentId));
  };
  
  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(event.target as Node)) {
        setShowModeDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  // State for active painting (initially the first one)
  const [activePainting, setActivePainting] = React.useState<number | null>(
    selectedPaintings.length > 0 ? selectedPaintings[0] : null
  );
  
  // State for selected multiple paintings (for Comparisons and Connections modes)
  const [selectedMultiplePaintings, setSelectedMultiplePaintings] = React.useState<number[]>(
    selectedPaintings.length > 0 ? [selectedPaintings[0]] : []
  );
  
  // State for mode selection dropdown
  const [showModeDropdown, setShowModeDropdown] = React.useState<boolean>(false);
  
  // State for painting comment dialog
  const [showPaintingComment, setShowPaintingComment] = React.useState<boolean>(false);
  const [paintingComment, setPaintingComment] = React.useState<string>("");
  
  // State for AI image editing
  const [isGeneratingImage, setIsGeneratingImage] = React.useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = React.useState<number>(0);
  const [originalImageUrl, setOriginalImageUrl] = React.useState<string | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = React.useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = React.useState<string>("");
  // 1. 新增state保存生成图片的原图尺寸
  const [generatedImageOriginalSize, setGeneratedImageOriginalSize] = useState<{width: number, height: number} | null>(null);
  // 1. 新增 paintingSizes state（如未定义则补充）
  const [paintingSizes, setPaintingSizes] = useState<Record<number, {width: number, height: number}>>({});
  
  // 定义消息类型
  interface ChatMessage {
    id: number;
    sender: "user" | "agent";
    text: string;
    timestamp: Date;
    isLoading?: boolean;
    isError?: boolean;
    agentType?: "regular" | "vts"; // 代理类型：普通代理或VTS代理
    agentTitle?: string;           // 代理标题
    agentImage?: string;           // 代理图像URL
    similarity?: number;           // 语义相似度
  }
  
  // State for chat messages
  const [messages, setMessages] = React.useState<ChatMessage[]>(() => {
    // 检查是否是多Agent模式
    if (localSelectedMode === 2 || localSelectedMode === 3) {
      // 多Agent模式，所有选中的Agent都说开场白
      const initialMessages: ChatMessage[] = [];
      let messageId = 1;
      
      // 获取所有选中的Agent数据
      const selectedAgentsData = appreciationAgents.filter(agent => localSelectedAgents.includes(agent.id));
      
      // 为每个Agent创建开场白消息
      selectedAgentsData.forEach(agent => {
        initialMessages.push({
          id: messageId++,
          sender: "agent",
          text: getAgentGreeting(agent.title),
          timestamp: new Date(),
          agentType: "regular",
          agentTitle: agent.title,
          agentImage: agent.imageSrc
        });
      });
      
      return initialMessages;
    } else {
      // 单Agent模式，只有一个开场白
      return [{
        id: 1,
        sender: "agent",
        text: getAgentGreeting(primaryAgent?.title || "Art Critic"),
        timestamp: new Date(),
        agentType: "regular",
        agentTitle: primaryAgent?.title || "Art Critic",
        agentImage: primaryAgent?.imageSrc || "/Art Critic.png"
      }];
    }
  });
  
  // State for new message input
  const [newMessage, setNewMessage] = React.useState<string>("");
  // 预设问题加载状态
  // const [loadingPresetQuestion, setLoadingPresetQuestion] = React.useState<number | null>(null);

  // 上传文件到服务器
  const uploadFile = async (url: string): Promise<string> => {
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
      const uploadResponse = await fetch(`${API_BASE_URL}/upload`, {
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
  };

  // 发送消息到服务器
  const sendMessageToServer = async (message: string, agentTitle: string, imageUrls?: string | string[] | null, resetConversation: boolean = false, sessionId: string = 'default') => {
    try {
      // 将单个图片URL转换为数组
      const urlsArray = imageUrls ? (Array.isArray(imageUrls) ? imageUrls : [imageUrls]) : [];
      let fileIds: string[] = [];
      
      // 附加选中图片的基本信息
      let messageWithImageInfo = message;
      if (urlsArray.length > 0) {
        const imageInfoLines = urlsArray.map((url, idx) => {
          const filename = url.split('/').pop() || '';
          const info = paintingInfoMap[filename];
          if (info) {
            return `【图片${idx + 1}: ${info}】`;
          } else {
            return `【图片${idx + 1}: ${url}】`;
          }
        });
        messageWithImageInfo = '限制500字以内\n' + imageInfoLines.join('\n') + '\n' + message;
      } else {
        messageWithImageInfo = '限制500字以内\n' + message;
      }
      
      // 处理图片上传
      if (urlsArray.length > 0) {
        console.log(`准备上传 ${urlsArray.length} 张图片:`, urlsArray);
        
        // 串行上传图片，避免并发问题
        for (const url of urlsArray) {
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
        
        console.log(`成功上传了 ${fileIds.length}/${urlsArray.length} 张图片，获取到文件ID:`, fileIds);
      }
      
      // 确保fileIds是有效的数组
      if (!Array.isArray(fileIds)) {
        console.error('fileIds不是数组:', fileIds);
        fileIds = [];
      }
      
      // 发送消息到代理服务器
      console.log('发送消息:', { agentTitle, message: messageWithImageInfo, fileIds, resetConversation, sessionId });
      
      // 构建请求体
      const requestBody = {
          agentTitle,
          message: messageWithImageInfo,
          fileIds,
          sessionId, // 使用传入的sessionId
          resetConversation, // 添加重置对话参数
      };
      
      console.log('完整请求体:', JSON.stringify(requestBody));
      
      const response = await fetch(`${API_BASE_URL}/chat`, {
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
      
      // 去除所有*和**符号，并将###替换为换行
      return typeof data.message === 'string' 
        ? formatAgentReply(data.message)
        : data.message;
    } catch (error) {
      console.error('发送消息失败:', error);
      return '对不起，我能力有限难以回答。';
    }
  };

  // 添加语义相似度计算函数
  const calculateSemanticSimilarity = async (message: string, agentTitle: string): Promise<number> => {
    try {
      // 简单实现基于关键词的语义相似度计算
      // 定义每个代理关注的关键词
      const agentKeywords: { [key: string]: string[] } = {
        'Art Critic': ['评价', '批评', '风格', '评论', '鉴赏', '美学', '艺术性', '表现力', '构图', '色彩'],
        'Art Historian': ['历史', '年代', '时期', '流派', '背景', '演变', '影响', '传统', '文化', '年份'],
        'Art Theorist': ['理论', '概念', '原理', '学派', '思想', '哲学', '意义', '符号', '解读', '分析'],
        'Art Collector': ['收藏', '价值', '市场', '拍卖', '投资', '真伪', '保存', '修复', '珍品', '稀有'],
        'Painter': ['技法', '材料', '笔触', '线条', '创作', '灵感', '表达', '画布', '颜料', '光影'],
        'General Audience': ['感受', '喜欢', '印象', '情感', '联想', '美丽', '有趣', '吸引', '故事', '想象']
      };
      
      // 获取当前代理的关键词
      const keywords = agentKeywords[agentTitle] || [];
      
      // 计算消息中包含的关键词数量
      let matchCount = 0;
      for (const keyword of keywords) {
        if (message.includes(keyword)) {
          matchCount++;
        }
      }
      
      // 计算相似度分数 (0-1之间)
      // 基础分0.3，每匹配一个关键词增加0.1，最高1.0
      let similarity = Math.min(0.3 + (matchCount * 0.1), 1.0);
      
      // 添加一些随机性，使结果更自然
      similarity = Math.min(Math.max(similarity + (Math.random() * 0.2 - 0.1), 0), 1);
      
      return similarity;
    } catch (error) {
      console.error('计算语义相似度失败:', error);
      // 出错时返回默认值0.5
      return 0.5;
    }
  };

  // 添加多Agent对话处理函数（并行版）
  const handleMultiAgentDialogue = async (userMessage: string, artworkUrls: string[]) => {
    // 获取所有选中的代理
    const selectedAgentData = appreciationAgents.filter(agent => localSelectedAgents.includes(agent.id));
    if (selectedAgentData.length === 0) return;
    
    // 计算每个代理与用户消息的语义相似度
    const similarityPromises = selectedAgentData.map(async (agent) => {
      const similarity = await calculateSemanticSimilarity(userMessage, agent.title);
      return {
        agentTitle: agent.title,
        similarity,
        agentImage: agent.imageSrc
      };
    });
    const similarities = await Promise.all(similarityPromises);
    // 按相似度降序排序
    const sortedAgents = similarities.sort((a, b) => b.similarity - a.similarity);
    
    // 添加所有代理的加载状态
    const loadingMessages: ChatMessage[] = sortedAgents.map((agent, i) => ({
      id: messages.length + 2 + i,
      sender: "agent",
      text: `${agent.agentTitle} 正在思考中`,
      timestamp: new Date(),
      isLoading: true,
      agentType: "regular",
      agentTitle: agent.agentTitle,
      agentImage: agent.agentImage
    }));
    setMessages(prev => [...prev, ...loadingMessages]);

    // 并行请求所有Agent
    await Promise.all(sortedAgents.map((agent, i) => (async () => {
      try {
        // 发送消息到服务器，设置resetConversation=false以保持每个Agent的对话连续性
        const response = await sendMessageToServer(userMessage, agent.agentTitle, artworkUrls, false);
        // 更新代理回复
        setMessages(prev => prev.map(msg => 
          msg.id === loadingMessages[i].id
            ? {
                id: msg.id,
                sender: "agent",
                text: formatAgentReply(response),
                timestamp: new Date(),
                isLoading: false,
                agentType: "regular",
                agentTitle: agent.agentTitle,
                agentImage: agent.agentImage,
                similarity: agent.similarity // 添加相似度信息用于展示
              }
            : msg
        ));
      } catch (error) {
        console.error(`获取${agent.agentTitle}回复失败:`, error);
        // 更新为错误消息
        setMessages(prev => prev.map(msg => 
          msg.id === loadingMessages[i].id
            ? {
                id: msg.id,
                sender: "agent",
                text: `抱歉，出现了错误: ${error instanceof Error ? error.message : '未知错误'}`,
                timestamp: new Date(),
                isLoading: false,
                isError: true,
                agentType: "regular",
                agentTitle: agent.agentTitle,
                agentImage: agent.agentImage
              }
            : msg
        ));
      }
    })()));
  };

  // 处理Multi-Agent Debate模式（使用流式API）
  const handleMultiAgentDebate = async (message: string, artworkUrls: string[], useVTSMode: boolean = false) => {
    // 获取所有选中的代理标题
    const selectedAgentTitles = appreciationAgents
      .filter(agent => localSelectedAgents.includes(agent.id))
      .map(agent => agent.title);
    
    if (selectedAgentTitles.length === 0) return;
    
    // 创建一个Map来存储每个Agent的加载消息ID
    const loadingMessageIds = new Map<string, number>();
    // 创建一个Map来跟踪已经收到回复的Agent
    const receivedResponses = new Set<string>();
    // 创建一个变量来跟踪是否已经添加了所有加载消息
    let allLoadingMessagesAdded = false;
    // 保存排序后的Agent顺序
    let orderedAgents: string[] = [];
    
    // 如果使用VTS模式，获取最近的VTS消息
    let lastVTSMessage = "";
    
    if (useVTSMode) {
      // 从最新到最旧查找VTS消息
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].agentType === "vts") {
          lastVTSMessage = messages[i].text;
          break;
        }
      }
      
      // 如果是第一次使用VTS或没找到之前的VTS消息
      if (!lastVTSMessage) {
        lastVTSMessage = "我来一步步引导你观察这幅画吧。";
      }
    }
    
    // 为每个代理准备加载中消息，但暂时不添加
    // 我们会在收到排序信息后按顺序添加
    const prepareLoadingMessages = (orderedAgentTitles: string[]) => {
      if (allLoadingMessagesAdded) return;
      
      // 保存排序后的Agent顺序，以便后续使用
      orderedAgents = [...orderedAgentTitles];
      
      // 获取当前消息数量，确保新消息ID不会与现有消息冲突
      // 使用函数式更新确保获取最新的messages状态
      setMessages(prevMessages => {
        const loadingMessages: ChatMessage[] = [];
        const startId = prevMessages.length + 1;
        
        orderedAgentTitles.forEach((agentTitle, i) => {
          const msgId = startId + i;
          loadingMessageIds.set(agentTitle, msgId);
          
          loadingMessages.push({
            id: msgId,
            sender: "agent" as const,
            text: `${agentTitle} 正在思考中`,
            timestamp: new Date(),
            isLoading: true,
            agentType: "regular" as const,
            agentTitle: agentTitle,
            agentImage: appreciationAgents.find(agent => agent.title === agentTitle)?.imageSrc
          });
        });
        
        // 添加所有加载中消息
        allLoadingMessagesAdded = true;
        return [...prevMessages, ...loadingMessages];
      });
    };
    
    // 处理单个Agent的回复
    const handleAgentResponse = async (
      agentTitle: string,
      response: string,
      similarity: number,
      isComplete: boolean,
      index: number
    ) => {
      console.log(`收到Agent ${agentTitle} 的回复:`, { response, similarity, isComplete, index });
      
      // 如果是空标题，表示发生了错误
      if (!agentTitle) {
        // 显示错误消息
        setMessages(prev => {
          const errorMsgId = prev.length + 1;
          return [
            ...prev,
            {
              id: errorMsgId,
              sender: "agent" as const,
              text: `辩论请求失败: ${response}`,
              timestamp: new Date(),
              isLoading: false,
              isError: true,
              agentType: "regular" as const,
              agentTitle: "系统",
              agentImage: "/image-38.png"
            }
          ];
        });
        return;
      }
      
      // 检查是否已经收到过这个Agent的回复
      if (receivedResponses.has(agentTitle)) {
        console.log(`已经收到过Agent ${agentTitle} 的回复，忽略`);
        return;
      }
      
      // 标记为已收到回复
      receivedResponses.add(agentTitle);
      
      // 获取该Agent的加载消息ID
      const loadingMsgId = loadingMessageIds.get(agentTitle);
      
      if (loadingMsgId) {
        // 更新加载中消息为实际回复
        setMessages(prev => prev.map(msg => 
          msg.id === loadingMsgId
            ? {
                id: msg.id,
                sender: "agent" as const,
                text: formatAgentReply(response),
                timestamp: new Date(),
                isLoading: false,
                agentType: "regular" as const,
                agentTitle: agentTitle,
                agentImage: appreciationAgents.find(agent => agent.title === agentTitle)?.imageSrc,
                similarity: similarity
              }
            : msg
        ));
        
        // 如果是VTS模式且这是最后一个Agent的回复，添加VTS引导
        if (useVTSMode && isComplete) {
          // 等待一小段时间，确保UI更新
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // 添加VTS加载中消息 - 使用函数式更新获取最新的消息列表长度
          let vtsLoadingMessageId = 0;
          
          // 使用函数式更新添加VTS加载中消息并获取其ID
          setMessages(prev => {
            // 计算新消息的ID，确保它是唯一的
            vtsLoadingMessageId = Math.max(...prev.map(msg => msg.id), 0) + 1;
            
            const vtsLoadingMessage = {
              id: vtsLoadingMessageId,
              sender: "agent" as const,
              text: `VTS 正在思考中`,
              timestamp: new Date(),
              isLoading: true,
              agentType: "vts" as const,
              agentTitle: "VTS",
              agentImage: VTS_AGENT.imageSrc
            };
            
            return [...prev, vtsLoadingMessage];
          });
          
                      try {
              // 等待一小段时间确保消息列表已更新
              await new Promise(resolve => setTimeout(resolve, 300));
              
              // 发送VTS初始化提示词到服务器
              const vtsPrompt = `用户刚才说："${message}"，作为VTS引导者，请提出下一个引导性问题，帮助用户更深入地观察和思考这幅画。`;
              
              // 发送VTS消息到服务器，不重置对话以保持连贯性
              // 使用独立的sessionId 'vts_session'
              const vtsResponse = await sendMessageToServer(vtsPrompt, "VTS", artworkUrls, false, 'vts_session');
              
              // 更新VTS回复 - 使用函数式更新确保我们有最新的消息列表
              setMessages(prev => {
                // 找到我们之前添加的VTS加载消息
                const loadingMsg = prev.find(msg => 
                  msg.agentType === "vts" && msg.isLoading && msg.id === vtsLoadingMessageId
                );
                
                if (!loadingMsg) {
                  console.error('无法找到VTS加载消息，ID:', vtsLoadingMessageId);
                  // 如果找不到加载消息，添加一个新的VTS消息
                  const newId = Math.max(...prev.map(msg => msg.id), 0) + 1;
                  return [...prev, {
                    id: newId,
                    sender: "agent" as const,
                    text: formatAgentReply(vtsResponse),
                    timestamp: new Date(),
                    isLoading: false,
                    agentType: "vts" as const,
                    agentTitle: "VTS",
                    agentImage: VTS_AGENT.imageSrc
                  }];
                }
                
                // 更新找到的加载消息
                return prev.map(msg => 
                  msg.id === loadingMsg.id
                    ? {
                        id: msg.id,
                        sender: "agent" as const,
                        text: formatAgentReply(vtsResponse),
                        timestamp: new Date(),
                        isLoading: false,
                        agentType: "vts" as const,
                        agentTitle: "VTS",
                        agentImage: VTS_AGENT.imageSrc
                      }
                    : msg
                );
              });
            } catch (error) {
              console.error('获取VTS回复失败:', error);
              
              // 更新为错误消息 - 使用函数式更新确保我们有最新的消息列表
              setMessages(prev => {
                // 找到我们之前添加的VTS加载消息
                const loadingMsg = prev.find(msg => 
                  msg.agentType === "vts" && msg.isLoading && msg.id === vtsLoadingMessageId
                );
                
                if (!loadingMsg) {
                  console.error('无法找到VTS加载消息，ID:', vtsLoadingMessageId);
                  // 如果找不到加载消息，添加一个新的错误消息
                  const newId = Math.max(...prev.map(msg => msg.id), 0) + 1;
                  return [...prev, {
                    id: newId,
                    sender: "agent" as const,
                    text: `抱歉，无法获取VTS引导: ${error instanceof Error ? error.message : '未知错误'}`,
                    timestamp: new Date(),
                    isLoading: false,
                    isError: true,
                    agentType: "vts" as const,
                    agentTitle: "VTS",
                    agentImage: VTS_AGENT.imageSrc
                  }];
                }
                
                // 更新找到的加载消息
                return prev.map(msg => 
                  msg.id === loadingMsg.id
                    ? {
                        id: msg.id,
                        sender: "agent" as const,
                        text: `抱歉，无法获取VTS引导: ${error instanceof Error ? error.message : '未知错误'}`,
                        timestamp: new Date(),
                        isLoading: false,
                        isError: true,
                        agentType: "vts" as const,
                        agentTitle: "VTS",
                        agentImage: VTS_AGENT.imageSrc
                      }
                    : msg
                );
              });
          }
        }
      } else {
        console.error(`未找到Agent ${agentTitle} 的加载消息ID`);
      }
    };
    
    // 使用流式API发送消息
    sendStreamingMessageToDebate(
      useVTSMode ? `VTS引导："${lastVTSMessage}"；用户发言："${message}"；你可以选择根据VTS的引导发言，也可以衍生用户的发言，也可以结合两者的话。` : message,
      selectedAgentTitles,
      (agentTitle: string, response: string, similarity: number, isComplete: boolean, orderedAgents?: string[], similarities?: {[agentTitle: string]: number}, index?: number) => {
        // 如果收到排序信息
        if (!agentTitle && response === 'order' && orderedAgents && Array.isArray(orderedAgents)) {
          console.log('收到Agent排序信息:', orderedAgents);
          // 根据排序信息添加加载消息
          prepareLoadingMessages(orderedAgents);
        } else {
          // 处理实际的Agent回复
          handleAgentResponse(agentTitle, response, similarity, isComplete, index || 0);
        }
      },
      artworkUrls,
      false, // 不重置对话
      'default' // 默认会话ID
    );
  };
  
  // 修改handleSendMessage函数，支持Multi-Agent Debate模式
  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;
    
    // 获取选中的画作URL（单张或多张）
    const artworkUrls = getSelectedArtworksUrls();
    
    // 添加用户消息到聊天记录
    const userMessage = {
      id: messages.length + 1,
      sender: "user" as const,
      text: newMessage,
      timestamp: new Date(),
    };
    
    setMessages([...messages, userMessage]);
    setNewMessage("");
    
    // 检查是否启用了VTS模式
    const isVTSModeActive = activeMethod === 'VTS';
    
    // 检查是否在Multi-Agent Debate模式下
    const isDebateMode = localSelectedMode === 3;
    // 检查是否在Multi-Agent Dialogue模式下
    const isMultiAgentDialogueMode = localSelectedMode === 2;
    
    // 如果是辩论模式
    if (isDebateMode) {
      // 即使在VTS模式下也使用辩论流程，但添加VTS提示
      await handleMultiAgentDebate(newMessage, artworkUrls, isVTSModeActive);
    }
    // 如果是VTS模式（非辩论模式），使用VTS对话流程
    else if (isVTSModeActive) {
      // 获取最近的VTS消息（如果有）
      let lastVTSMessage = "";
      // 从最新到最旧查找VTS消息
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].agentType === "vts") {
          lastVTSMessage = messages[i].text;
          break;
        }
      }
      
      // 检查是否是多Agent模式
      const isMultiAgentMode = localSelectedMode === 2;
      
      // 获取当前选中的所有非特殊代理
      const selectedAgentData = appreciationAgents.filter(agent => 
        localSelectedAgents.includes(agent.id) && !SPECIAL_AGENT_IDS.includes(agent.id)
      );
      
      if (vtsDialogueState === 'vts_turn') {
        // 用户回复VTS引导，接下来是Agent的回合
        setVtsDialogueState('agent_turn');
        
        // 在多Agent模式下，为每个Agent创建加载消息
        if (isMultiAgentMode && selectedAgentData.length > 1) {
          // 创建一个数组存储所有Agent的加载中消息
          const agentLoadingMessages: ChatMessage[] = [];
          
          // 为每个选中的Agent添加加载中消息
          selectedAgentData.forEach((agent, index) => {
            agentLoadingMessages.push({
              id: messages.length + 2 + index,
              sender: "agent" as const,
              text: `${agent.title} 正在思考中`,
              timestamp: new Date(),
              isLoading: true,
              agentType: "regular" as const,
              agentTitle: agent.title,
              agentImage: agent.imageSrc
            });
          });
          
          // 添加所有Agent的加载中消息
          setMessages(prev => [...prev, ...agentLoadingMessages]);
          
          // 并行处理所有Agent的回复
          Promise.all(selectedAgentData.map((agent, index) => (async () => {
            try {
              // 构建Agent消息，包含VTS引导和用户消息
              const agentPrompt = `VTS引导："${lastVTSMessage}"；用户发言："${newMessage}"；你可以选择根据VTS的引导发言，也可以衍生用户的发言，也可以结合两者的话。`;
              
              // 发送Agent消息到服务器，不重置对话以保持连贯性
              const agentResponse = await sendMessageToServer(agentPrompt, agent.title, artworkUrls, false);
              
              // 更新Agent回复
              setMessages(prev => prev.map(msg => 
                msg.id === agentLoadingMessages[index].id 
                  ? {
                      id: msg.id,
                      sender: "agent" as const,
                      text: formatAgentReply(agentResponse),
                      timestamp: new Date(),
                      isLoading: false,
                      agentType: "regular" as const,
                      agentTitle: agent.title,
                      agentImage: agent.imageSrc
                    }
                  : msg
              ));
            } catch (error) {
              console.error(`获取Agent ${agent.title} 回复失败:`, error);
              
              // 更新为错误消息
              setMessages(prev => prev.map(msg => 
                msg.id === agentLoadingMessages[index].id 
                  ? {
                      id: msg.id,
                      sender: "agent" as const,
                      text: `抱歉，出现了错误: ${error instanceof Error ? error.message : '未知错误'}`,
                      timestamp: new Date(),
                      isLoading: false,
                      isError: true,
                      agentType: "regular" as const,
                      agentTitle: agent.title,
                      agentImage: agent.imageSrc
                    }
                  : msg
              ));
            }
          })())).then(() => {
            // 所有Agent回复后，添加VTS加载中消息
            const vtsLoadingMessage = {
              id: messages.length + selectedAgentData.length + 2,
              sender: "agent" as const,
              text: `VTS 正在思考中`,
              timestamp: new Date(),
              isLoading: true,
              agentType: "vts" as const,
              agentTitle: "VTS",
              agentImage: VTS_AGENT.imageSrc
            };
            
            setMessages(prev => [...prev, vtsLoadingMessage]);
            
            (async () => {
              try {
                // 构建VTS消息 - 只关注用户消息
                const vtsPrompt = `用户刚才说："${newMessage}"，作为VTS引导者，请提出下一个引导性问题，帮助用户更深入地观察和思考这幅画。`;
                
                // 发送VTS消息到服务器，不重置对话以保持连贯性
                // 注意：使用独立的sessionId 'vts_session'
                const vtsResponse = await sendMessageToServer(vtsPrompt, "VTS", artworkUrls, false, 'vts_session');
                
                // 更新VTS回复
                setMessages(prev => prev.map(msg => 
                  msg.id === vtsLoadingMessage.id 
                    ? {
                        id: msg.id,
                        sender: "agent" as const,
                        text: formatAgentReply(vtsResponse),
                        timestamp: new Date(),
                        isLoading: false,
                        agentType: "vts" as const,
                        agentTitle: "VTS",
                        agentImage: VTS_AGENT.imageSrc
                      }
                    : msg
                ));
                
                // 重置为VTS回合
                setVtsDialogueState('vts_turn');
              } catch (error) {
                console.error('获取VTS回复失败:', error);
                
                // 更新为错误消息
                setMessages(prev => prev.map(msg => 
                  msg.id === vtsLoadingMessage.id 
                    ? {
                        id: msg.id,
                        sender: "agent" as const,
                        text: `抱歉，出现了错误: ${error instanceof Error ? error.message : '未知错误'}`,
                        timestamp: new Date(),
                        isLoading: false,
                        isError: true,
                        agentType: "vts" as const,
                        agentTitle: "VTS",
                        agentImage: VTS_AGENT.imageSrc
                      }
                    : msg
                ));
                
                // 出错时也重置为VTS回合
                setVtsDialogueState('vts_turn');
              }
            })();
          });
        } else {
          // 单Agent模式 - 使用原有逻辑
          // 获取当前选中的代理
          const agentTitle = getSelectedAgentTitle();
        
        // 添加Agent加载中消息
        const agentLoadingMessage = {
          id: messages.length + 2,
          sender: "agent" as const,
          text: `${agentTitle} 正在思考中`,
          timestamp: new Date(),
          isLoading: true,
          agentType: "regular" as const,
          agentTitle: agentTitle,
          agentImage: appreciationAgents.find(agent => agent.title === agentTitle)?.imageSrc
        };
        
        setMessages(prev => [...prev, agentLoadingMessage]);
        
        try {
          // 构建Agent消息，包含VTS引导和用户消息
          const agentPrompt = `VTS引导："${lastVTSMessage}"；用户发言："${newMessage}"；你可以选择根据VTS的引导发言，也可以衍生用户的发言，也可以结合两者的话。`;
          
            // 发送Agent消息到服务器，不重置对话以保持连贯性
            (async () => {
              const agentResponse = await sendMessageToServer(agentPrompt, agentTitle, artworkUrls, false);
          
          // 更新Agent回复
          setMessages(prev => prev.map(msg => 
            msg.id === agentLoadingMessage.id 
              ? {
                  id: msg.id,
                  sender: "agent" as const,
                  text: formatAgentReply(agentResponse),
                  timestamp: new Date(),
                  isLoading: false,
                  agentType: "regular" as const,
                  agentTitle: agentTitle,
                  agentImage: appreciationAgents.find(agent => agent.title === agentTitle)?.imageSrc
                }
              : msg
          ));
          
          // Agent回复后，添加VTS加载中消息
          const vtsLoadingMessage = {
            id: messages.length + 3,
            sender: "agent" as const,
            text: `VTS 正在思考中`,
            timestamp: new Date(),
            isLoading: true,
            agentType: "vts" as const,
            agentTitle: "VTS",
            agentImage: VTS_AGENT.imageSrc
          };
          
          setMessages(prev => [...prev, vtsLoadingMessage]);
          
          try {
            // 构建VTS消息，包含用户消息和Agent回复
            const vtsPrompt = `用户刚才说："${newMessage}"，Agent回复："${agentResponse}"，作为VTS引导者，请提出下一个引导性问题，帮助用户更深入地观察和思考这幅画。`;
            
                // 发送VTS消息到服务器，不重置对话以保持连贯性
                // 注意：使用独立的sessionId 'vts_session'
                const vtsResponse = await sendMessageToServer(vtsPrompt, "VTS", artworkUrls, false, 'vts_session');
            
            // 更新VTS回复
            setMessages(prev => prev.map(msg => 
              msg.id === vtsLoadingMessage.id 
                ? {
                    id: msg.id,
                    sender: "agent" as const,
                    text: formatAgentReply(vtsResponse),
                    timestamp: new Date(),
                    isLoading: false,
                    agentType: "vts" as const,
                    agentTitle: "VTS",
                    agentImage: VTS_AGENT.imageSrc
                  }
                : msg
            ));
            
            // 重置为VTS回合
            setVtsDialogueState('vts_turn');
          } catch (error) {
            console.error('获取VTS回复失败:', error);
            
            // 更新为错误消息
            setMessages(prev => prev.map(msg => 
              msg.id === vtsLoadingMessage.id 
                ? {
                    id: msg.id,
                    sender: "agent" as const,
                    text: `抱歉，出现了错误: ${error instanceof Error ? error.message : '未知错误'}`,
                    timestamp: new Date(),
                    isLoading: false,
                    isError: true,
                    agentType: "vts" as const,
                    agentTitle: "VTS",
                    agentImage: VTS_AGENT.imageSrc
                  }
                : msg
            ));
            
            // 出错时也重置为VTS回合
            setVtsDialogueState('vts_turn');
          }
            })();
        } catch (error) {
          console.error('获取Agent回复失败:', error);
          
          // 更新为错误消息
          setMessages(prev => prev.map(msg => 
            msg.id === agentLoadingMessage.id 
              ? {
                  id: msg.id,
                  sender: "agent" as const,
                  text: `抱歉，出现了错误: ${error instanceof Error ? error.message : '未知错误'}`,
                  timestamp: new Date(),
                  isLoading: false,
                  isError: true,
                  agentType: "regular" as const,
                  agentTitle: agentTitle,
                  agentImage: appreciationAgents.find(agent => agent.title === agentTitle)?.imageSrc
                }
              : msg
          ));
          
          // 重置为VTS回合
          setVtsDialogueState('vts_turn');
          }
        }
      } else {
        // 如果是Agent的回合，用户回复后直接是Agent回复
        // 在多Agent模式下，为每个Agent创建加载消息
        if (isMultiAgentMode && selectedAgentData.length > 1) {
          // 创建一个数组存储所有Agent的加载中消息
          const agentLoadingMessages: ChatMessage[] = [];
          
          // 为每个选中的Agent添加加载中消息
          selectedAgentData.forEach((agent, index) => {
            agentLoadingMessages.push({
              id: messages.length + 2 + index,
              sender: "agent" as const,
              text: `${agent.title} 正在思考中`,
              timestamp: new Date(),
              isLoading: true,
              agentType: "regular" as const,
              agentTitle: agent.title,
              agentImage: agent.imageSrc
            });
          });
          
          // 添加所有Agent的加载中消息
          setMessages(prev => [...prev, ...agentLoadingMessages]);
          
          // 并行处理所有Agent的回复
          Promise.all(selectedAgentData.map((agent, index) => (async () => {
            try {
              // 构建Agent消息
              const agentPrompt = `用户发言："${newMessage}"，请回复用户。`;
              
              // 发送Agent消息到服务器，不重置对话以保持连贯性
              const agentResponse = await sendMessageToServer(agentPrompt, agent.title, artworkUrls, false);
              
              // 更新Agent回复
              setMessages(prev => prev.map(msg => 
                msg.id === agentLoadingMessages[index].id 
                  ? {
                      id: msg.id,
                      sender: "agent" as const,
                      text: formatAgentReply(agentResponse),
                      timestamp: new Date(),
                      isLoading: false,
                      agentType: "regular" as const,
                      agentTitle: agent.title,
                      agentImage: agent.imageSrc
                    }
                  : msg
              ));
            } catch (error) {
              console.error(`获取Agent ${agent.title} 回复失败:`, error);
              
              // 更新为错误消息
              setMessages(prev => prev.map(msg => 
                msg.id === agentLoadingMessages[index].id 
                  ? {
                      id: msg.id,
                      sender: "agent" as const,
                      text: `抱歉，出现了错误: ${error instanceof Error ? error.message : '未知错误'}`,
                      timestamp: new Date(),
                      isLoading: false,
                      isError: true,
                      agentType: "regular" as const,
                      agentTitle: agent.title,
                      agentImage: agent.imageSrc
                    }
                  : msg
              ));
            }
          })())).then(() => {
            // 切换到VTS回合
            setVtsDialogueState('vts_turn');
            
            // 所有Agent回复后，添加VTS加载中消息
            const vtsLoadingMessage = {
              id: messages.length + selectedAgentData.length + 2,
              sender: "agent" as const,
              text: `VTS 正在思考中`,
              timestamp: new Date(),
              isLoading: true,
              agentType: "vts" as const,
              agentTitle: "VTS",
              agentImage: VTS_AGENT.imageSrc
            };
            
            setMessages(prev => [...prev, vtsLoadingMessage]);
            
            (async () => {
              try {
                // 构建VTS消息 - 只关注用户消息
                const vtsPrompt = `用户刚才说："${newMessage}"，作为VTS引导者，请提出下一个引导性问题，帮助用户更深入地观察和思考这幅画。`;
                
                // 发送VTS消息到服务器，不重置对话以保持连贯性
                // 注意：使用独立的sessionId 'vts_session'
                const vtsResponse = await sendMessageToServer(vtsPrompt, "VTS", artworkUrls, false, 'vts_session');
                
                // 更新VTS回复
                setMessages(prev => prev.map(msg => 
                  msg.id === vtsLoadingMessage.id 
                    ? {
                        id: msg.id,
                        sender: "agent" as const,
                        text: formatAgentReply(vtsResponse),
                        timestamp: new Date(),
                        isLoading: false,
                        agentType: "vts" as const,
                        agentTitle: "VTS",
                        agentImage: VTS_AGENT.imageSrc
                      }
                    : msg
                ));
              } catch (error) {
                console.error('获取VTS回复失败:', error);
                
                // 更新为错误消息
                setMessages(prev => prev.map(msg => 
                  msg.id === vtsLoadingMessage.id 
                    ? {
                        id: msg.id,
                        sender: "agent" as const,
                        text: `抱歉，出现了错误: ${error instanceof Error ? error.message : '未知错误'}`,
                        timestamp: new Date(),
                        isLoading: false,
                        isError: true,
                        agentType: "vts" as const,
                        agentTitle: "VTS",
                        agentImage: VTS_AGENT.imageSrc
                      }
                    : msg
                ));
              }
            })();
          });
        } else {
          // 单Agent模式 - 使用原有逻辑
          // 获取当前选中的代理
          const agentTitle = getSelectedAgentTitle();
          
        // 添加Agent加载中消息
        const agentLoadingMessage = {
          id: messages.length + 2,
          sender: "agent" as const,
          text: `${agentTitle} 正在思考中`,
          timestamp: new Date(),
          isLoading: true,
          agentType: "regular" as const,
          agentTitle: agentTitle,
          agentImage: appreciationAgents.find(agent => agent.title === agentTitle)?.imageSrc
        };
        
        setMessages(prev => [...prev, agentLoadingMessage]);
        
          (async () => {
        try {
          // 构建Agent消息
          const agentPrompt = `用户发言："${newMessage}"，请回复用户。`;
          
              // 发送Agent消息到服务器，不重置对话以保持连贯性
              const agentResponse = await sendMessageToServer(agentPrompt, agentTitle, artworkUrls, false);
          
          // 更新Agent回复
          setMessages(prev => prev.map(msg => 
            msg.id === agentLoadingMessage.id 
              ? {
                  id: msg.id,
                  sender: "agent" as const,
                  text: formatAgentReply(agentResponse),
                  timestamp: new Date(),
                  isLoading: false,
                  agentType: "regular" as const,
                  agentTitle: agentTitle,
                  agentImage: appreciationAgents.find(agent => agent.title === agentTitle)?.imageSrc
                }
              : msg
          ));
          
          // 切换到VTS回合
          setVtsDialogueState('vts_turn');
          
          // Agent回复后，添加VTS加载中消息
          const vtsLoadingMessage = {
            id: messages.length + 3,
            sender: "agent" as const,
            text: `VTS 正在思考中`,
            timestamp: new Date(),
            isLoading: true,
            agentType: "vts" as const,
            agentTitle: "VTS",
            agentImage: VTS_AGENT.imageSrc
          };
          
          setMessages(prev => [...prev, vtsLoadingMessage]);
          
          try {
            // 构建VTS消息，包含用户消息和Agent回复
            const vtsPrompt = `用户刚才说："${newMessage}"，Agent回复："${agentResponse}"，作为VTS引导者，请提出下一个引导性问题，帮助用户更深入地观察和思考这幅画。`;
            
                // 发送VTS消息到服务器，不重置对话以保持连贯性
                // 注意：使用独立的sessionId 'vts_session'
                const vtsResponse = await sendMessageToServer(vtsPrompt, "VTS", artworkUrls, false, 'vts_session');
            
            // 更新VTS回复
            setMessages(prev => prev.map(msg => 
              msg.id === vtsLoadingMessage.id 
                ? {
                    id: msg.id,
                    sender: "agent" as const,
                    text: formatAgentReply(vtsResponse),
                    timestamp: new Date(),
                    isLoading: false,
                    agentType: "vts" as const,
                    agentTitle: "VTS",
                    agentImage: VTS_AGENT.imageSrc
                  }
                : msg
            ));
          } catch (error) {
            console.error('获取VTS回复失败:', error);
            
            // 更新为错误消息
            setMessages(prev => prev.map(msg => 
              msg.id === vtsLoadingMessage.id 
                ? {
                    id: msg.id,
                    sender: "agent" as const,
                    text: `抱歉，出现了错误: ${error instanceof Error ? error.message : '未知错误'}`,
                    timestamp: new Date(),
                    isLoading: false,
                    isError: true,
                    agentType: "vts" as const,
                    agentTitle: "VTS",
                    agentImage: VTS_AGENT.imageSrc
                  }
                : msg
            ));
          }
        } catch (error) {
          console.error('获取Agent回复失败:', error);
          
          // 更新为错误消息
          setMessages(prev => prev.map(msg => 
            msg.id === agentLoadingMessage.id 
              ? {
                  id: msg.id,
                  sender: "agent" as const,
                  text: `抱歉，出现了错误: ${error instanceof Error ? error.message : '未知错误'}`,
                  timestamp: new Date(),
                  isLoading: false,
                  isError: true,
                  agentType: "regular" as const,
                  agentTitle: agentTitle,
                  agentImage: appreciationAgents.find(agent => agent.title === agentTitle)?.imageSrc
                }
              : msg
          ));
        }
          })();
      }
    } 
    } 
    // 如果是多Agent模式（不管是否选择了Method），使用基于语义相似度的多Agent对话
    else if (isMultiAgentDialogueMode && localSelectedAgents.length > 1) {
      // 使用基于语义相似度的多Agent对话
      await handleMultiAgentDialogue(newMessage, artworkUrls);
    }
    // 否则使用普通对话流程
    else {
      // 获取当前选中的代理
      const agentTitle = getSelectedAgentTitle();
      
      // 添加加载中消息
      const loadingMessage = {
        id: messages.length + 2,
        sender: "agent" as const,
        text: `${agentTitle} 正在思考中`,
        timestamp: new Date(),
        isLoading: true,
        agentType: "regular" as const,
        agentTitle: agentTitle,
        agentImage: appreciationAgents.find(agent => agent.title === agentTitle)?.imageSrc
      };
      
      setMessages(prev => [...prev, loadingMessage]);
      
      try {
        // 发送消息到服务器，不重置对话以保持连贯性
        const response = await sendMessageToServer(newMessage, agentTitle, artworkUrls, false);
        
        // 更新代理回复
        setMessages(prev => prev.map(msg => 
          msg.id === loadingMessage.id 
            ? {
                id: msg.id,
                sender: "agent" as const,
                text: formatAgentReply(response),
                timestamp: new Date(),
                isLoading: false,
                agentType: "regular" as const,
                agentTitle: agentTitle,
                agentImage: appreciationAgents.find(agent => agent.title === agentTitle)?.imageSrc
            }
            : msg
        ));
      } catch (error) {
        console.error('获取回复失败:', error);
        
        // 更新为错误消息
        setMessages(prev => prev.map(msg => 
          msg.id === loadingMessage.id 
            ? {
                id: msg.id,
                sender: "agent" as const,
                text: `抱歉，出现了错误: ${error instanceof Error ? error.message : '未知错误'}`,
                timestamp: new Date(),
                isLoading: false,
                isError: true,
                agentType: "regular" as const,
                agentTitle: agentTitle,
                agentImage: appreciationAgents.find(agent => agent.title === agentTitle)?.imageSrc
            }
            : msg
        ));
      }
    }
  };

  // Handle pressing Enter to send message
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  
  // 在组件顶部添加一个ref来跟踪是否已发送初始消息
  const initialMessageSentRef = React.useRef<boolean>(false);

  // 添加一个引用来访问聊天消息容器
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // 创建一个函数来滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);
  
  // 在消息更新时自动滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // 图床链接映射
  const imageUrlMap: Record<string, string> = {
    'xrk1.jpeg': 'https://z.wiki/u/IpkFhR',
    'xrk2.jpeg': 'https://z.wiki/u/mpYISq',
    'xrk3.jpeg': 'https://z.wiki/u/JRVojG',
    'xrk4.jpeg': 'https://z.wiki/u/VHFZQv',
    'xrk5.jpeg': 'https://z.wiki/u/Sy5mF0'
  };

  // 处理AI图像生成
  const handleGenerateImage = async () => {
    const selectedImage = artworkImages.find(p => p.id === activePainting);
    let selectedImageUrl = selectedImage?.src;
    if (selectedImageUrl) {
      const filename = selectedImageUrl.split('/').pop();
      if (filename && imageUrlMap[filename]) {
        selectedImageUrl = imageUrlMap[filename];
      }
    }
    if (!aiPrompt || !selectedImageUrl) return;
    try {
      setIsGeneratingImage(true);
      setGenerationProgress(10);
      
      // 1. 获取图片尺寸
      const img = new window.Image();
      img.src = selectedImageUrl;
      await new Promise(resolve => { img.onload = resolve; });
      // 保存原图尺寸到state
      setGeneratedImageOriginalSize({ width: img.width, height: img.height });
      
      // 2. 匹配最接近的标准比例
      const aspectRatios = [
        { label: "3:4", value: 3 / 4 },
        { label: "4:3", value: 4 / 3 },
        { label: "1:1", value: 1 },
        { label: "3:2", value: 3 / 2 },
        { label: "2:3", value: 2 / 3 },
        { label: "16:9", value: 16 / 9 },
        { label: "9:16", value: 9 / 16 },
        { label: "9:21", value: 9 / 21 },
        { label: "21:9", value: 21 / 9 },
      ];
      const actualRatio = img.width / img.height;
      let closest = aspectRatios[0];
      let minDiff = Math.abs(actualRatio - closest.value);
      for (const ratio of aspectRatios) {
        const diff = Math.abs(actualRatio - ratio.value);
        if (diff < minDiff) {
          closest = ratio;
          minDiff = diff;
        }
      }
      setGenerationProgress(30);
      
      // 3. 生成请求
      const generateUuid = await liblibAIService.runComfy({
        templateUuid: "4df2efa0f18d46dc9758803e478eb51c",
        generateParams: {
          "362": {
            "class_type": "FluxKontextProImageNode",
            "inputs": {
              "aspect_ratio": closest.label
            }
          },
          "326": {
            "class_type": "LoadImage",
            "inputs": {
              "image": selectedImageUrl
            }
          },
          "329": {
            "class_type": "LibLibTranslate",
            "inputs": {
              "text": aiPrompt
            }
          },
          "workflowUuid": "15606431ca40417a81a45e25fb29fb9c"
        }
      });
      
      console.log('生成请求成功，UUID:', generateUuid);
      setGenerationProgress(70);
      
      // 5. 轮询获取生成结果
      console.log('开始轮询结果...');
      const resultImageUrl = await liblibAIService.waitAppResult(generateUuid);
      
      // 6. 设置生成的图片URL
      console.log('获取到生成图片URL:', resultImageUrl);
      setGeneratedImageUrl(resultImageUrl);
      setGenerationProgress(100);
    } catch (error) {
      console.error('图像生成失败:', error);
      // 显示错误消息
      alert(`图像生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // 重置图像编辑状态
  const resetImageEditing = () => {
    setGeneratedImageUrl(null);
    setAiPrompt("");
    setGenerationProgress(0);
  };
  
  // 在组件顶部添加VTS对话状态追踪
  const [vtsDialogueState, setVtsDialogueState] = useState<'vts_turn' | 'agent_turn'>('vts_turn');
  
  // 监听模式变化，在单Agent模式和多Agent模式之间切换时更新消息
  React.useEffect(() => {
    // 从多Agent模式切换到单Agent模式
    if (localSelectedMode === 1) {
      // 获取当前选中的第一个非特殊代理
      const regularAgents = localSelectedAgents.filter(id => !SPECIAL_AGENT_IDS.includes(id));
      if (regularAgents.length > 0) {
        const primaryAgentId = regularAgents[0];
        const primaryAgent = appreciationAgents.find(agent => agent.id === primaryAgentId);
        
        if (primaryAgent) {
          // 重置聊天区，只保留主要代理的开场白
          setMessages([{
            id: 1,
            sender: "agent",
            text: getAgentGreeting(primaryAgent.title),
            timestamp: new Date(),
            agentType: "regular",
            agentTitle: primaryAgent.title,
            agentImage: primaryAgent.imageSrc
          }]);
        }
      }
    } 
    // 从单Agent模式切换到多Agent模式
    else if (localSelectedMode === 2 || localSelectedMode === 3) {
      // 获取所有选中的Agent数据
      const selectedAgentsData = appreciationAgents.filter(agent => localSelectedAgents.includes(agent.id));
      
      if (selectedAgentsData.length > 0) {
        // 创建所有代理的开场白消息
        const initialMessages: ChatMessage[] = [];
        let messageId = 1;
        
        selectedAgentsData.forEach(agent => {
          initialMessages.push({
            id: messageId++,
            sender: "agent",
            text: getAgentGreeting(agent.title),
            timestamp: new Date(),
            agentType: "regular",
            agentTitle: agent.title,
            agentImage: agent.imageSrc
          });
        });
        
        // 更新消息列表
        setMessages(initialMessages);
      }
    }
  }, [localSelectedMode]);
  
  // 在组件挂载时自动重置辩论会话
  React.useEffect(() => {
    // 只在Multi-Agent Debate模式下执行
    if (localSelectedMode === 3) {
      // 重置辩论会话
      (async () => {
        try {
          await resetDebateSession('default');
          console.log('Multi-Agent Debate模式激活时自动重置辩论会话');
        } catch (error) {
          console.error('自动重置辩论会话失败:', error);
        }
      })();
    }
  }, [localSelectedMode]);  // 当模式变化时执行
  
  // 在页面刷新后检查是否需要重置辩论会话
  React.useEffect(() => {
    // 检测是否是页面刷新后的首次加载
    const isPageRefresh = sessionStorage.getItem('hasLoaded') === null;
    sessionStorage.setItem('hasLoaded', 'true');
    
    if (isPageRefresh) {
      console.log('检测到页面刷新，重置所有辩论会话');
      // 重置辩论会话
      (async () => {
        try {
          await resetDebateSession('default');
          console.log('页面刷新后自动重置辩论会话');
        } catch (error) {
          console.error('页面刷新后重置辩论会话失败:', error);
        }
      })();
    }
  }, []);  // 空依赖数组，只在组件挂载时执行一次
  
  // 预加载多图模式下所有选中图片的宽高
  useEffect(() => {
    selectedMultiplePaintings.forEach(paintingId => {
      if (!paintingSizes[paintingId]) {
        const painting = artworkImages.find(p => p.id === paintingId);
        if (painting && painting.src) {
          const img = new window.Image();
          img.src = painting.src;
          img.onload = () => {
            setPaintingSizes(sizes => ({
              ...sizes,
              [paintingId]: { width: img.width, height: img.height }
            }));
          };
        }
      }
    });
  }, [selectedMultiplePaintings, artworkImages]);
  
  return (
    <div className="min-h-screen bg-gray-50">
      <style>{scrollbarStyles}</style>
      {/* Header */}
      <header className="w-full h-20 bg-[#57c2f3] flex items-center justify-between px-8">
        <h1 className="text-white text-3xl font-semibold">
          Conversation with Art Agent
        </h1>
        <div className="flex items-center gap-3 relative" ref={modeDropdownRef}>
          <span className="text-white font-medium text-lg">Appreciation Mode:</span>
          <div 
            className="bg-white/20 px-6 py-2 rounded-full text-white font-medium text-lg backdrop-blur-sm cursor-pointer flex items-center"
            onClick={(e) => {
              e.stopPropagation();
              setShowModeDropdown(!showModeDropdown);
            }}
          >
            {appreciationModes.find(mode => mode.id === localSelectedMode)?.title || "Not selected"}
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              className="h-5 w-5 ml-2" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          
          {/* Mode dropdown menu */}
          {showModeDropdown && (
            <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-lg shadow-lg z-20 overflow-hidden">
              {appreciationModes.map(mode => (
                <div 
                  key={mode.id}
                  className={`px-6 py-3 cursor-pointer hover:bg-gray-100 ${localSelectedMode === mode.id ? 'bg-[#57c2f3]/10 text-[#57c2f3] font-medium' : 'text-gray-800'}`}
                  onClick={() => {
                    setLocalSelectedMode(mode.id);
                    setShowModeDropdown(false);
                    
                    // 如果选择了Single-Agent Dialogue模式（假设ID为1）
                    if (mode.id === 1) {
                      // 检查是否有VTS代理
                      const hasVTSAgent = localSelectedAgents.includes(VTS_AGENT_ID);
                      
                      // 如果有多个代理，只保留第一个非特殊代理和VTS代理（如果有的话）
                      if (localSelectedAgents.length > 1) {
                        // 获取第一个非特殊代理
                        const regularAgents = localSelectedAgents.filter(id => !SPECIAL_AGENT_IDS.includes(id));
                        if (regularAgents.length > 0) {
                          // 如果有VTS代理，保留VTS代理和第一个普通代理
                          if (hasVTSAgent) {
                            setLocalSelectedAgents([regularAgents[0], VTS_AGENT_ID]);
                          } else {
                            // 否则只保留第一个普通代理
                            setLocalSelectedAgents([regularAgents[0]]);
                          }
                        } else if (hasVTSAgent) {
                          // 如果没有普通代理但有VTS代理，只保留VTS代理
                          setLocalSelectedAgents([VTS_AGENT_ID]);
                        }
                      }
                    }
                  }}
                >
                  {mode.title}
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-80px)]">
        {/* Left Section - Appreciation Methods and Paintings */}
        <div className="w-3/5 p-8 bg-white flex flex-col">
          {/* Appreciation Method Selection */}
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">
              Select Appreciation Method
            </h2>
            <div className="flex gap-4 flex-wrap">
              {['VTS', 'Comparisons', 'Connections', 'Expansions'].map((method) => (
                <button
                  key={method}
                  className={`flex-1 py-3 px-4 rounded-full font-medium transition-colors duration-200
                    ${activeMethod === method 
                      ? 'bg-[#57c2f3] text-white' 
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-800'}`}
                  onClick={() => {
                    // 如果点击的是已选中的方法，则取消选择
                    if (activeMethod === method) {
                      handleMethodChange(null);
                    } else {
                      handleMethodChange(method);
                    }
                  }}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>
          
          {/* Selected Painting Display */}
          <div className="flex-1 flex flex-col">
            {selectedPaintings.length > 0 && (
              <>
                {/* Main selected paintings area */}
                <div className="mb-6 flex-1 flex items-center justify-center relative">
                  {/* 单选模式下显示单个画作 */}
                  {!isMultiSelectMode(activeMethod) && activePainting && (
                    <div className="relative inline-block">
                      {generatedImageUrl ? (
                        (() => {
                          const size = paintingSizes[activePainting ?? -1];
                          let containerStyle = {};
                          if (size) {
                            // 计算按高度60vh时的宽度（px）
                            const widthByHeight = window.innerHeight * 0.6 * (size.width / size.height);
                            const width56vw = window.innerWidth * 0.56;
                            if (widthByHeight > width56vw) {
                              // 以宽度为准
                              containerStyle = {
                                width: '56vw',
                                height: `calc(56vw * ${size.height / size.width})`,
                                maxWidth: '56vw',
                                maxHeight: '60vh',
                                aspectRatio: `${size.width} / ${size.height}`,
                                position: 'relative',
                                overflow: 'hidden'
                              };
                            } else {
                              // 以高度为准
                              containerStyle = {
                                height: '60vh',
                                width: `calc(60vh * ${size.width / size.height})`,
                                maxHeight: '60vh',
                                maxWidth: '56vw',
                                aspectRatio: `${size.width} / ${size.height}`,
                                position: 'relative',
                                overflow: 'hidden'
                              };
                            }
                          }
                          return (
                            <div
                              className="w-full flex justify-center items-center max-w-screen-lg mx-auto"
                              style={containerStyle}
                            >
                              <div style={{ width: '100%', height: '100%' }}>
                        <ImageCompareSlider
                          originalImage={artworkImages.find(p => p.id === activePainting)?.src || ''}
                          generatedImage={generatedImageUrl}
                          className="rounded-md shadow-lg border-2 border-[#57c2f3]"
                        />
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        // 显示原始图片
                        <img 
                          src={artworkImages.find(p => p.id === activePainting)?.src}
                          alt={artworkImages.find(p => p.id === activePainting)?.alt}
                          className="max-h-[60vh] max-w-full object-contain rounded-md shadow-lg border-2 border-[#57c2f3]"
                        />
                      )}
                      
                      {/* 按钮组 - 位于图片右下角 */}
                      <div className="absolute bottom-4 right-4 flex space-x-2">
                        {/* AI编辑/评论按钮 */}
                        <button 
                          className="bg-[#57c2f3] hover:bg-[#4ab3e8] text-white rounded-full p-3 shadow-lg z-10"
                          onClick={() => {
                            // 切换评论对话框显示状态
                            setShowPaintingComment(!showPaintingComment);
                            
                            // 如果打开对话框，设置当前图片URL
                            if (!showPaintingComment) {
                              const currentImage = artworkImages.find(p => p.id === activePainting);
                              if (currentImage) {
                                setOriginalImageUrl(currentImage.src);
                              }
                            }
                            
                            // 如果关闭对话框，重置编辑状态
                            if (showPaintingComment) {
                              resetImageEditing();
                            }
                          }}
                          aria-label={generatedImageUrl ? "重置图片" : "AI编辑图片"}
                          title={generatedImageUrl ? "重置图片" : "AI编辑图片"}
                        >
                          {generatedImageUrl ? (
                            // 重置图标
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 2v6h6"></path>
                              <path d="M21 12A9 9 0 0 0 6 5.3L3 8"></path>
                              <path d="M21 22v-6h-6"></path>
                              <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"></path>
                            </svg>
                          ) : (
                            // 编辑图标
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                          )}
                        </button>
                      </div>
                      
                      {/* AI编辑/评论对话框 */}
                      {showPaintingComment && (
                        <div className={`absolute ${
                          isMultiSelectMode(activeMethod) 
                            ? "bottom-16 right-8 w-64" 
                            : "bottom-16 right-8 w-80"
                        } flex flex-col shadow-lg bg-white rounded-lg p-2 z-20`}>
                          {/* 关闭按钮 */}
                          <div className="flex justify-between items-center mb-1">
                            <h3 className="font-medium text-gray-700 text-sm">
                              {generatedImageUrl ? "Image Generated" : "AI Image Editing"}
                            </h3>
                            <button 
                              onClick={() => {
                                setShowPaintingComment(false);
                              }}
                              className="text-gray-500 hover:text-gray-700"
                              aria-label="关闭"
                              title="关闭"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                          
                          {/* 提示词输入和生成按钮 */}
                          {!generatedImageUrl && (
                            <>
                              <textarea
                                className="w-full px-2 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#57c2f3] text-xs mb-1"
                                placeholder="Type your prompt here..."
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                rows={isMultiSelectMode(activeMethod) ? 2 : 3}
                                disabled={isGeneratingImage}
                              />
                              <button
                                className={`w-full py-1 rounded-lg font-medium text-white text-xs ${
                                  isGeneratingImage || !aiPrompt.trim() 
                                    ? 'bg-gray-400 cursor-not-allowed' 
                                    : 'bg-[#57c2f3] hover:bg-[#4ab3e8]'
                                }`}
                                onClick={handleGenerateImage}
                                disabled={isGeneratingImage || !aiPrompt.trim()}
                              >
                                {isGeneratingImage ? 'Generating...' : 'Generate'}
                              </button>
                              
                              {/* 生成进度条 */}
                              {isGeneratingImage && (
                                <div className="mt-1">
                                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                                    <div 
                                      className="bg-[#57c2f3] h-1.5 rounded-full transition-all duration-300" 
                                      style={{ width: `${generationProgress}%` }}
                                    ></div>
                                  </div>
                                  <p className="text-[10px] text-gray-500 mt-0.5 text-center">
                                    {generationProgress}% - {
                                      generationProgress < 30 ? '准备中' :
                                      generationProgress < 50 ? '上传图片' :
                                      generationProgress < 70 ? '开始生成' : '等待结果'
                                    }
                                  </p>
                                </div>
                              )}
                            </>
                          )}
                          
                          {/* 生成完成后的操作按钮 */}
                          {generatedImageUrl && (
                            <div className="flex flex-col gap-1 mt-1">
                              <p className="text-xs text-gray-600">
                                使用滑块对比原图与生成图片
                              </p>
                              <div className="flex gap-1">
                                <button
                                  className="flex-1 py-1 rounded-lg font-medium text-white text-xs bg-[#57c2f3] hover:bg-[#4ab3e8]"
                                  onClick={() => {
                                    // 重新编辑
                                    setGeneratedImageUrl(null);
                                  }}
                                >
                                  重新编辑
                                </button>
                                <button
                                  className="flex-1 py-1 rounded-lg font-medium text-white text-xs bg-green-500 hover:bg-green-600"
                                  onClick={() => {
                                    // 保存编辑结果并关闭对话框
                                    setShowPaintingComment(false);
                                  }}
                                >
                                  确认
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* 多选模式下横向展示所有选中的画作，使用滚动条而不换行 */}
                  {isMultiSelectMode(activeMethod) && (
                    <div className="relative w-full">
                      {/* 滚动指示器 - 当有多个画作时显示 */}
                      {selectedMultiplePaintings.length > 1 && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 backdrop-blur-sm rounded-full p-1 shadow-md z-10">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      )}
                      <div className="flex overflow-x-auto pb-4 gap-4 justify-start items-center custom-scrollbar">
                        {selectedMultiplePaintings.map(paintingId => {
                          const painting = artworkImages.find(p => p.id === paintingId);
                          const size = paintingSizes[paintingId];
                          if (!size) {
                            // 宽高未获取到，渲染 loading 占位
                          return (
                            <div 
                              key={paintingId}
                                className="relative flex-shrink-0 flex items-center justify-center bg-gray-100 rounded-md shadow-lg border-2 border-[#57c2f3]"
                                style={{ height: '60vh', width: '60vh', position: 'relative' }}
                              >
                                <span className="text-gray-400">加载中...</span>
                              </div>
                            );
                          }
                          const width = size.width;
                          const height = size.height;
                          const aspectWidth = `calc(60vh * ${width / height})`;
                          return (
                            <div
                              key={paintingId}
                              className="relative flex-shrink-0"
                              style={{
                                height: '60vh',
                                width: aspectWidth,
                                maxWidth: '100%', // 关键，防止溢出
                                position: 'relative'
                              }}
                            >
                              {generatedImageUrl && activePainting === paintingId ? (
                                <ImageCompareSlider
                                  originalImage={painting?.src || ''}
                                  generatedImage={generatedImageUrl}
                                  className="rounded-md shadow-lg border-2 border-[#57c2f3]"
                                />
                              ) : (
                                <img 
                                  src={painting?.src}
                                  alt={painting?.alt}
                                  style={{ width: '100%', height: '100%' }}
                                  className="rounded-md shadow-lg border-2 border-[#57c2f3]"
                                />
                              )}
                              {/* 每个画作都显示按钮组 */}
                              <div className="absolute bottom-4 right-4 flex space-x-2">
                                {/* AI编辑按钮 */}
                                <button 
                                  className="bg-[#57c2f3] hover:bg-[#4ab3e8] text-white rounded-full p-3 shadow-lg z-10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActivePainting(paintingId);
                                    setShowPaintingComment(!showPaintingComment);
                                    if (!showPaintingComment) {
                                      const currentImage = artworkImages.find(p => p.id === paintingId);
                                      if (currentImage) {
                                        setOriginalImageUrl(currentImage.src);
                                      }
                                    }
                                    if (showPaintingComment) {
                                      resetImageEditing();
                                    }
                                  }}
                                  aria-label={generatedImageUrl ? "重置图片" : "AI编辑图片"}
                                  title={generatedImageUrl ? "重置图片" : "AI编辑图片"}
                                >
                                  {generatedImageUrl ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 2v6h6"></path>
                                      <path d="M21 12A9 9 0 0 0 6 5.3L3 8"></path>
                                      <path d="M21 22v-6h-6"></path>
                                      <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"></path>
                                    </svg>
                                  ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                    </svg>
                                  )}
                                </button>
                              </div>
                              
                              {/* AI编辑/评论对话框 - 在点击了编辑按钮的画作上显示 */}
                              {showPaintingComment && activePainting === paintingId && (
                                <div className="absolute bottom-16 right-8 flex flex-col shadow-lg bg-white rounded-lg p-2 w-64 z-20">
                                  {/* 关闭按钮 */}
                                  <div className="flex justify-between items-center mb-1">
                                    <h3 className="font-medium text-gray-700 text-sm">
                                      {generatedImageUrl ? "Image Generated" : "AI Image Editing"}
                                    </h3>
                                    <button 
                                      onClick={() => {
                                        setShowPaintingComment(false);
                                      }}
                                      className="text-gray-500 hover:text-gray-700"
                                      aria-label="关闭"
                                      title="关闭"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                  
                                  {/* 提示词输入和生成按钮 */}
                                  {!generatedImageUrl && (
                                    <>
                                      <textarea
                                        className="w-full px-2 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#57c2f3] text-xs mb-1"
                                        placeholder="Type your prompt here..."
                                        value={aiPrompt}
                                        onChange={(e) => setAiPrompt(e.target.value)}
                                        rows={2}
                                        disabled={isGeneratingImage}
                                      />
                                      <button
                                        className={`w-full py-1 rounded-lg font-medium text-white text-xs ${
                                          isGeneratingImage || !aiPrompt.trim() 
                                            ? 'bg-gray-400 cursor-not-allowed' 
                                            : 'bg-[#57c2f3] hover:bg-[#4ab3e8]'
                                        }`}
                                        onClick={handleGenerateImage}
                                        disabled={isGeneratingImage || !aiPrompt.trim()}
                                      >
                                        {isGeneratingImage ? 'Generating...' : 'Generate'}
                                      </button>
                                      
                                      {/* 生成进度条 */}
                                      {isGeneratingImage && (
                                        <div className="mt-1">
                                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                                            <div 
                                              className="bg-[#57c2f3] h-1.5 rounded-full transition-all duration-300" 
                                              style={{ width: `${generationProgress}%` }}
                                            ></div>
                                          </div>
                                          <p className="text-[10px] text-gray-500 mt-0.5 text-center">
                                            {generationProgress}% - {
                                              generationProgress < 30 ? '准备中' :
                                              generationProgress < 50 ? '上传图片' :
                                              generationProgress < 70 ? '开始生成' : '等待结果'
                                            }
                                          </p>
                                        </div>
                                      )}
                                    </>
                                  )}
                                  
                                  {/* 生成完成后的操作按钮 */}
                                  {generatedImageUrl && (
                                    <div className="flex flex-col gap-1 mt-1">
                                      <p className="text-xs text-gray-600">
                                        使用滑块对比原图与生成图片
                                      </p>
                                      <div className="flex gap-1">
                                        <button
                                          className="flex-1 py-1 rounded-lg font-medium text-white text-xs bg-[#57c2f3] hover:bg-[#4ab3e8]"
                                          onClick={() => {
                                            // 重新编辑
                                            setGeneratedImageUrl(null);
                                          }}
                                        >
                                          重新编辑
                                        </button>
                                        <button
                                          className="flex-1 py-1 rounded-lg font-medium text-white text-xs bg-green-500 hover:bg-green-600"
                                          onClick={() => {
                                            // 保存编辑结果并关闭对话框
                                            setShowPaintingComment(false);
                                          }}
                                        >
                                          确认
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Thumbnails of paintings */}
                <div className="flex flex-col gap-2">
                  {/* 多选模式提示 */}
                  {isMultiSelectMode(activeMethod) && (
                    <div className="text-sm text-gray-600 mb-1 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-[#57c2f3]" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                      You can select multiple paintings
                    </div>
                  )}
                  
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {selectedPaintings.map((paintingId) => {
                      const painting = artworkImages.find(p => p.id === paintingId);
                      return (
                        <div 
                          key={paintingId}
                          className={`w-24 h-24 flex-shrink-0 rounded-md overflow-hidden cursor-pointer relative
                            ${paintingId === activePainting ? 'shadow-lg border-2 border-[#57c2f3]' : 
                              'border border-gray-200'}`}
                          onClick={() => {
                            // 设置为当前活跃画作
                            setActivePainting(paintingId);
                            
                            // 在多选模式下处理选择/取消选择
                            if (isMultiSelectMode(activeMethod)) {
                              if (selectedMultiplePaintings.includes(paintingId)) {
                                // 如果已选中且不是唯一选中的画作，则取消选择
                                if (selectedMultiplePaintings.length > 1) {
                                  const newSelected = selectedMultiplePaintings.filter(id => id !== paintingId);
                                  setSelectedMultiplePaintings(newSelected);
                                  // 更新多选模式共享状态
                                  setMultiSelectPaintings(newSelected);
                                  // 如果移除了当前活跃画作，设置第一个画作为活跃
                                  if (paintingId === activePainting && newSelected.length > 0) {
                                    setActivePainting(newSelected[0]);
                                  }
                                }
                              } else {
                                // 如果未选中，则添加到选中列表并设为活跃
                                const newSelected = [...selectedMultiplePaintings, paintingId];
                                setSelectedMultiplePaintings(newSelected);
                                // 更新多选模式共享状态
                                setMultiSelectPaintings(newSelected);
                                setActivePainting(paintingId);
                              }
                            } else {
                              // 非多选模式下，只选择当前画作
                              setSelectedMultiplePaintings([paintingId]);
                            }
                          }}
                        >
                          <img 
                            src={painting?.src}
                            alt={painting?.alt}
                            className="w-full h-full object-cover"
                          />
                          {/* 显示选中标记 */}
                          {(selectedMultiplePaintings.includes(paintingId) || paintingId === activePainting) && (
                            <div className="absolute top-1 right-1 bg-[#57c2f3] rounded-full w-5 h-5 flex items-center justify-center shadow-md">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Section - Chat */}
        <div className="w-2/5 p-8 bg-white border-l border-gray-200 flex flex-col h-full">
          {/* Agent Info */}
          <div className="mb-6 pb-4 border-b border-gray-200">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-medium text-gray-700">Selected Agents</h3>
              <button 
                className="text-sm text-blue-500 hover:text-blue-700 flex items-center"
                onClick={() => setShowUnselectedAgents(!showUnselectedAgents)}
              >
                {showUnselectedAgents ? 'Hide' : 'Show'} agent options
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  className={`h-4 w-4 ml-1 transition-transform ${showUnselectedAgents ? 'rotate-180' : ''}`}
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            
            {/* Selected agents area */}
            <div 
              className="flex flex-wrap gap-4 items-center min-h-[100px] p-2 rounded-lg bg-gray-50"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const agentId = Number(e.dataTransfer.getData("agentId"));
                // 检查是否为有效的代理ID
                if (agentId) {
                  // 如果是Single-Agent模式，直接替换现有非特殊代理
                  if (localSelectedMode === 1) {
                    // 即使该代理已经在选中列表中，也执行addAgent操作以刷新聊天区
                    addAgent(agentId);
                  } else {
                    // 在其他模式下，只有当代理不在选中列表中时才添加
                    if (!localSelectedAgents.includes(agentId)) {
                      addAgent(agentId);
                    }
                  }
                }
              }}
            >
              {/* Regular agents */}
              {appreciationAgents
                .filter(agent => localSelectedAgents.includes(agent.id))
                .map(agent => (
                  <div 
                    key={agent.id} 
                    className="flex flex-col items-center relative"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("agentId", agent.id.toString());
                      setDraggedAgent(agent.id);
                    }}
                    onDragEnd={() => setDraggedAgent(null)}
                    onClick={() => setActiveAgent(activeAgent === agent.id ? null : agent.id)}
                  >
                                          <div className="h-16 w-16 relative" key={`agent-image-${agent.id}`}>
                      <img 
                        src={agent.imageSrc} 
                        alt={agent.title} 
                        className="h-full w-full object-contain"
                      />
                      {activeAgent === agent.id && (
                        <button
                          className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]"
                          onClick={(e) => {
                            e.stopPropagation(); // 防止触发外层的onClick
                            removeAgent(agent.id);
                            setActiveAgent(null);
                          }}
                          title="Remove agent"
                          style={{ display: localSelectedMode === 1 ? 'none' : 'flex' }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div className="mt-1 text-center">
                      <h2 className="text-xs font-medium text-gray-600">
                        {agent.title}
                      </h2>
                    </div>
                  </div>
              ))}

              {localSelectedAgents.length === 0 && !activeMethod && (
                <div className="w-full text-center py-4 text-gray-500">
                  Drag agents here to select them
                </div>
              )}
            </div>
            
            {/* Unselected agents dropdown */}
            {showUnselectedAgents && (
              <div className="mt-4 p-3 border border-gray-200 rounded-lg bg-white">
                <h4 className="text-sm font-medium text-gray-600 mb-2">Available Agents</h4>
                <div 
                  className="flex flex-wrap gap-4 min-h-[80px]"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const agentId = Number(e.dataTransfer.getData("agentId"));
                    // 防止将特殊代理拖入未选择区域
                    if (agentId && localSelectedAgents.includes(agentId) && !SPECIAL_AGENT_IDS.includes(agentId)) {
                      removeAgent(agentId);
                    }
                  }}
                >
                  {unselectedAgents.map(agent => (
                    <div 
                      key={agent.id} 
                      className="flex flex-col items-center cursor-grab"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("agentId", agent.id.toString());
                        setDraggedAgent(agent.id);
                      }}
                      onDragEnd={() => setDraggedAgent(null)}
                      onClick={() => addAgent(agent.id)}
                    >
                      <div className="h-14 w-14">
                        <img 
                          src={agent.imageSrc} 
                          alt={agent.title} 
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <div className="mt-1 text-center">
                        <h2 className="text-xs font-medium text-gray-600">
                          {agent.title}
                        </h2>
                      </div>
                    </div>
                  ))}
                  {unselectedAgents.length === 0 && (
                    <div className="w-full text-center py-3 text-gray-500">
                      No more agents available
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto mb-4">
            {/* VTS模式激活时显示的标签 */}
            {activeMethod === 'VTS' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-center">
                <div className="flex items-center justify-center mb-2">
                  <img 
                    src={VTS_AGENT.imageSrc}
                    alt="VTS"
                    className="w-8 h-8 mr-2"
                  />
                  <h3 className="text-lg font-medium text-green-800">VTS 模式已激活</h3>
                </div>
                <p className="text-sm text-green-700">
                  视觉思维策略将引导您一步步观察和思考画作
                </p>
              </div>
            )}

            {messages.map((message) => {
              // VTS消息使用特殊样式
              if (message.agentType === "vts") {
                return (
                  <div
                    key={message.id}
                    className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 mx-auto max-w-[100%]"
                  >
                    <div className="flex items-center justify-center mb-2">
                      <img 
                        src={VTS_AGENT.imageSrc}
                        alt="VTS"
                        className="w-6 h-6 mr-2"
                      />
                      <span className="font-medium text-green-800">VTS 引导</span>
                    </div>
                    <div className="text-green-800 text-center">
                      {message.isLoading ? (
                        <div className="flex items-center justify-center">
                          <span>{message.text}</span>
                          <div className="ml-2 flex space-x-1">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                          </div>
                        </div>
                      ) : (
                        message.text
                      )}
                    </div>
                    <div className="text-xs text-green-600 mt-2 text-center">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                );
              }
              
              // 普通消息保持原样式
              return (
                <div
                  key={message.id}
                  className={`mb-4 ${
                    message.sender === "user" ? "text-right" : "text-left"
                  }`}
                >
                  {message.sender === "agent" && (
                    <div className="flex items-center mb-1">
                      <img 
                        src={message.agentImage || "/Art Critic.png"}
                        alt={message.agentTitle || "Agent"}
                        className="w-6 h-6 rounded-full mr-2 object-cover"
                      />
                      <span className="text-xs font-medium text-gray-700">
                        {message.agentTitle || "Art Critic"}
                        {/* 显示语义相似度，如果有的话 */}
                        {message.similarity !== undefined && localSelectedMode === 2 && !activeMethod && (
                          <span className="ml-2 text-xs text-gray-500">
                            (相似度: {(message.similarity * 100).toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  <div
                    className={`inline-block rounded-lg py-2 px-4 max-w-[80%] ${
                      message.sender === "user"
                        ? "bg-[#57c2f3] text-white"
                        : message.isError 
                          ? "bg-red-100 text-red-800"
                          : "bg-gray-100 text-gray-800"
                    } leading-relaxed`}
                  >
                    {message.isLoading ? (
                      <div className="flex items-center">
                        <span>{message.text}</span>
                        <div className="ml-2 flex space-x-1">
                          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                      </div>
                    ) : (
                      message.text
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input */}
          <div className="border-t border-gray-200 pt-4">
            {/* 预设问题按钮 - 只在特定模式下显示 */}
            {/*
            {(activeMethod === 'Comparisons' || activeMethod === 'Connections' || activeMethod === 'Expansions') && (
              <div className="mb-2">
                <div className="text-xs text-gray-500 mb-1">你可以这样问:</div>
                <div className="flex flex-wrap gap-1">
                  {PRESET_QUESTIONS[activeMethod as keyof typeof PRESET_QUESTIONS]?.map((question, index) => (
                    <button
                      key={index}
                      className={`px-2 py-1 rounded-full text-xs transition-colors duration-200 ${
                        loadingPresetQuestion === index 
                          ? 'bg-gray-300 text-gray-500 cursor-wait' 
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                      }`}
                      onClick={() => {
                        // 设置加载状态
                        setLoadingPresetQuestion(index);
                        // 设置消息并直接发送
                        setNewMessage(question);
                        // 使用setTimeout确保状态更新后再发送
                        setTimeout(() => {
                          handleSendMessage();
                          // 发送后重置加载状态
                          setTimeout(() => {
                            setLoadingPresetQuestion(null);
                          }, 500);
                        }, 0);
                      }}
                      disabled={loadingPresetQuestion !== null}
                    >
                      {loadingPresetQuestion === index ? '发送中...' : (question.length > 20 ? `${question.substring(0, 18)}...` : question)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <textarea
                className="flex-1 px-4 py-2 focus:outline-none"
                placeholder="Type your message here..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
              />
              <button
                onClick={handleSendMessage}
                className="bg-[#57c2f3] hover:bg-[#4ab3e8] text-white px-4 m-1 rounded-lg transition-all duration-200"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
      
    </div>
  );
};
