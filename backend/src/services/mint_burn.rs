use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OperationStatus { Pending, Verified, Executing, Completed, Failed }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MintBurnOperation {
    pub id: String,
    pub operation_type: String,
    pub amount: u64,
    pub target: String,
    pub status: OperationStatus,
    pub signature: Option<String>,
}

pub struct MintBurnService;
impl MintBurnService { pub fn new() -> Self { Self } }
